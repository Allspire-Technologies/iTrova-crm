// resend-activation-email — re-sends the account activation link to a business owner whose email
// is still unconfirmed. Admin, or Support assigned to the business. Recipient and link are resolved
// SERVER-SIDE (service role): the browser passes only the business id, and the link is neither
// returned to it nor written to the message log.
//
// Why a magic link: admin generateLink(type "signup") requires a password and would overwrite the
// owner's. Verifying a magic link signs the owner in AND marks the email confirmed, which is the
// outcome the original signup link produced.
//
// Secrets:  RESEND_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, EMAIL_REPLY_TO (as send-customer-email)
//           ITROVA_APP_URL (optional) — where the link lands; must be an allowed redirect URL in Auth.
// Deploy:   supabase functions deploy resend-activation-email
// Pinned exact version — a floating @2 could silently change behaviour between cold starts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const DEFAULT_APP_URL = "https://itrova.allspire.tech";
const TEMPLATE_KEY = "activation_resend";
const SUBJECT = "Activate your iTrova account";
const COOLDOWN_SECONDS = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("EMAIL_FROM_ADDRESS");
    const fromName = Deno.env.get("EMAIL_FROM_NAME") ?? "iTrova";
    const replyTo = Deno.env.get("EMAIL_REPLY_TO");
    const appUrl = (Deno.env.get("ITROVA_APP_URL") ?? DEFAULT_APP_URL).replace(/\/+$/, "");
    if (!resendKey || !fromEmail) return json({ error: "Email is not configured (missing RESEND_API_KEY / EMAIL_FROM_ADDRESS)." }, 500);

    // 1) Caller must be admin or support; support only for businesses assigned to them.
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: role, error: roleErr } = await caller.rpc("cs_my_role");
    if (roleErr) return json({ error: roleErr.message }, 401);
    if (role !== "admin" && role !== "support") return json({ error: "Only Management/Admin or Support can resend activation emails." }, 403);

    const { business_id, idempotency_key } = await req.json().catch(() => ({}));
    if (!business_id || typeof business_id !== "string") return json({ error: "A business id is required." }, 400);

    if (role !== "admin") {
      const { data: canSee, error: seeErr } = await caller.rpc("cs_can_see_business", { p_business_id: business_id });
      if (seeErr) return json({ error: seeErr.message }, 401);
      if (canSee !== true) return json({ error: "You can only message customers assigned to you." }, 403);
    }

    // 2) Resolve the owner server-side and refuse if the email is already activated.
    const admin = createClient(url, service);
    const { data: biz, error: bizErr } = await admin.from("businesses").select("id, name, owner_id").eq("id", business_id).maybeSingle();
    if (bizErr) return json({ error: bizErr.message }, 500);
    if (!biz) return json({ error: "Business not found." }, 404);
    const { data: ownerUser, error: ownerErr } = await admin.auth.admin.getUserById(biz.owner_id);
    const toEmail = ownerUser?.user?.email ?? null;
    if (ownerErr || !toEmail) return json({ error: "This business has no owner email on file." }, 422);
    const confirmedAt = ownerUser?.user?.email_confirmed_at ?? null;
    if (confirmedAt) return json({ error: "This account is already activated.", activated_at: confirmedAt }, 409);

    // 3) One send per minute per business, whoever clicks.
    const since = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString();
    const { data: recent } = await admin.from("cs_customer_message")
      .select("created_at").eq("business_id", business_id).eq("template_key", TEMPLATE_KEY).eq("status", "sent")
      .gte("created_at", since).limit(1);
    if (recent && recent.length > 0) return json({ error: `An activation email was sent less than ${COOLDOWN_SECONDS} seconds ago. Give it a moment.` }, 429);

    // 4) Mint the link. The token lives only in this request and the email body.
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: toEmail, options: { redirectTo: `${appUrl}/` } });
    if (link.error) return json({ error: link.error.message }, 400);
    const actionLink = link.data.properties?.action_link;
    if (!actionLink) return json({ error: "Could not generate the activation link." }, 500);

    const { data: profile } = await admin.from("profiles").select("owner_name").eq("id", biz.owner_id).maybeSingle();
    const toName = profile?.owner_name ?? null;
    const greeting = toName ? `Hi ${esc(toName)},` : "Hello,";
    const closing = replyTo
      ? "If you did not create this account, you can ignore this email. Reply to this email if you need a hand."
      : "If you did not create this account, you can ignore this email.";
    const render = (href: string) =>
      `<p>${greeting}</p>
       <p>Here is a fresh link to activate your iTrova account for <strong>${esc(biz.name ?? "your business")}</strong>.</p>
       <p><a href="${esc(href)}">Activate my account</a></p>
       <p>Or copy this address into your browser:<br>${esc(href)}</p>
       <p>The link signs you in and marks your email as activated. It expires after a short while, so use it soon.</p>
       <p>${closing}</p>
       <p>The iTrova team</p>`;
    const html = render(actionLink);

    // Retry-safe: the UI holds a key per attempt-series; Resend replays a known key after a
    // timeout-then-retry instead of sending twice.
    const clientKey = typeof idempotency_key === "string" && /^[A-Za-z0-9-]{8,64}$/.test(idempotency_key) ? idempotency_key : crypto.randomUUID();
    const idempotencyKey = `activation-${business_id}-${clientKey}`;

    // The log never carries the token: a staff member who can read the log must not be able to
    // sign in as the owner.
    const logRow = {
      business_id,
      to_email: toEmail,
      to_name: toName,
      subject: SUBJECT,
      body: render("[activation link]"),
      template_key: TEMPLATE_KEY,
      created_by: (await caller.auth.getUser()).data.user?.id ?? null,
    };
    const logFailure = async (message: string) => {
      const { error } = await admin.from("cs_customer_message").insert({ ...logRow, status: "failed", error: message });
      if (error) console.error("cs_customer_message log insert failed (failed path):", error.message);
    };

    let providerId: string | null = null;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}`, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [toEmail], subject: SUBJECT, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
        // A stalled provider connection must not hold the invocation until the platform kills it.
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = String(payload?.message ?? payload?.error ?? `Resend returned ${res.status}`);
        await logFailure(message);
        return json({ error: message }, 502);
      }
      if (typeof payload?.id !== "string" || payload.id === "") {
        const message = "Resend accepted the request but returned no message id. Delivery unconfirmed, retry is safe.";
        await logFailure(message);
        return json({ error: message }, 502);
      }
      providerId = payload.id;
    } catch (e) {
      const message = (e as Error)?.name === "TimeoutError" ? "Email provider timed out (15s)." : "Couldn't reach the email provider.";
      await logFailure(message);
      return json({ error: message }, 502);
    }

    const { error: logErr } = await admin.from("cs_customer_message").insert({ ...logRow, status: "sent", provider_message_id: providerId });
    if (logErr) {
      console.error("cs_customer_message log insert failed (sent path):", logErr.message);
      return json({ ok: true, to_email: toEmail, logged: false });
    }
    return json({ ok: true, to_email: toEmail });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error." }, 500);
  }
});
