// send-referrer-welcome — emails a newly-registered affiliate/staff referrer their code, share
// link, and what the program entails (built from referral_config). Also sends the polite decline
// for a rejected website application (decision: "rejected" + application_id). When an
// application_id is passed, the outcome is stamped on cs_referrer_application (notified_at /
// notified_kind / notify_error) so the CRM shows delivery state. Admin-only. The referrer's
// details + config are read SERVER-SIDE from the code, so the browser only passes the code.
// The Resend key + from-identity live here (Edge Function secrets), never the browser.
//
// Secrets:  RESEND_API_KEY=re_...  EMAIL_FROM_ADDRESS=no-reply@mail.allspire.tech
//           EMAIL_FROM_NAME="iTrova"  EMAIL_REPLY_TO=<monitored inbox — REQUIRED in spirit here:
//           the template invites replies, and the from address is a no-reply>
// Deploy:   supabase functions deploy send-referrer-welcome
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
const money = (n: number) => "₦" + Number(n || 0).toLocaleString();

const SIGNUP_BASE = "https://itrova.allspire.tech/auth";

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
    if (!resendKey || !fromEmail) return json({ error: "Email is not configured (missing RESEND_API_KEY / EMAIL_FROM_ADDRESS)." }, 500);

    // Caller must be admin (only admins register referrers).
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: role, error: roleErr } = await caller.rpc("cs_my_role");
    if (roleErr) return json({ error: roleErr.message }, 401);
    if (role !== "admin") return json({ error: "Only Management/Admin can send referrer invites." }, 403);

    const { code, idempotency_key, application_id, decision } = await req.json().catch(() => ({}));
    const appId = typeof application_id === "string" && application_id ? application_id : null;

    // Retry-safe: same scheme as send-customer-email — the UI holds a key per attempt-series, and
    // Resend replays a known key instead of double-sending after a timeout-then-retry.
    const clientKey = typeof idempotency_key === "string" && /^[A-Za-z0-9-]{8,64}$/.test(idempotency_key)
      ? idempotency_key
      : crypto.randomUUID();

    const admin = createClient(url, service);

    // Best-effort outcome stamp on the application; never masks the send result.
    const stamp = async (kind: "welcome" | "decline", error: string | null) => {
      if (!appId) return;
      try {
        await admin.from("cs_referrer_application")
          .update({ notified_at: error ? null : new Date().toISOString(), notified_kind: kind, notify_error: error })
          .eq("id", appId);
      } catch { /* stamping is advisory */ }
    };

    const deliver = async (to: string, subject: string, html: string, idempotencyKey: string): Promise<string | null> => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}`, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
        // A stalled provider connection must not hold the invocation until the platform kills it.
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) return payload?.message ?? payload?.error ?? `Resend returned ${res.status}`;
      // A 2xx without a message id is not a confirmed send; the idempotency key makes retrying safe.
      if (typeof payload?.id !== "string" || payload.id === "") return "Resend accepted the request but returned no message id. Delivery unconfirmed, retry is safe.";
      return null;
    };

    // ---- Decline path: a rejected website application ----
    if (decision === "rejected") {
      if (!appId) return json({ error: "An application id is required." }, 400);
      const { data: app, error: appErr } = await admin.from("cs_referrer_application").select("id, name, email").eq("id", appId).maybeSingle();
      if (appErr) return json({ error: appErr.message }, 500);
      if (!app) return json({ error: "Application not found." }, 404);
      if (!app.email) { await stamp("decline", "No email on file"); return json({ error: "This applicant has no email on file." }, 422); }
      const closingDecline = replyTo
        ? "If you think we have missed something, or your situation changes, reply to this email and we will take another look."
        : "If your situation changes, you are welcome to apply again later.";
      const declineHtml =
        `<p>Hi ${esc(app.name)},</p>
         <p>Thank you for applying to the iTrova affiliate program. After reviewing your application, we are not able to bring you on board at this time.</p>
         <p>${closingDecline}</p>
         <p>The iTrova team</p>`;
      const err = await deliver(app.email, "Your iTrova affiliate application", declineHtml, `app-${appId}-${clientKey}`);
      await stamp("decline", err);
      if (err) return json({ error: err }, 502);
      return json({ ok: true, to_email: app.email });
    }

    // ---- Welcome path: a registered referrer ----
    if (!code || typeof code !== "string") return json({ error: "A referrer code is required." }, 400);
    const idempotencyKey = `ref-${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${clientKey}`;

    // Load the referrer + program config server-side.
    const { data: ref, error: refErr } = await admin.from("cs_referrer").select("*").eq("code", code.toUpperCase()).maybeSingle();
    if (refErr) return json({ error: refErr.message }, 500);
    if (!ref) return json({ error: "Referrer not found." }, 404);
    if (!ref.email) { await stamp("welcome", "No email on file"); return json({ error: "This referrer has no email on file." }, 422); }
    const { data: cfg } = await admin.from("referral_config").select("*").maybeSingle();

    const share = ref.share_percent ?? cfg?.affiliate_share_percent ?? 25;
    const staffBonus = (cfg?.staff_bonus ?? {}) as Record<string, number>;
    const link = `${SIGNUP_BASE}?ref=${encodeURIComponent(ref.code)}`;
    const isAffiliate = ref.kind === "affiliate";

    const terms = isAffiliate
      ? `<li>You earn <strong>${share}%</strong> of everything a business you refer pays in their first 12 months.</li>
         <li>Rewards are paid once the business makes its first payment.</li>`
      : `<li>You earn a bonus for each business you refer that subscribes: Pro ${money(staffBonus.pro ?? 0)}, Business ${money(staffBonus.business ?? 0)}, Enterprise ${money(staffBonus.enterprise ?? 0)}.</li>
         <li>Bonuses are paid once the referred business makes its first payment.</li>`;

    // "Reply to this email" is only promised when a monitored reply-to is configured — the from
    // address is a no-reply, and inviting replies into a void is worse than not inviting them.
    const closing = replyTo
      ? "Share your link on WhatsApp, with your network, or anywhere business owners are. Reply to this email if you have any questions."
      : "Share your link on WhatsApp, with your network, or anywhere business owners are.";

    const html =
      `<p>Hi ${esc(ref.name)},</p>
       <p>You're set up as an iTrova ${isAffiliate ? "affiliate" : "referral partner"}. Here's everything you need to start earning.</p>
       <p><strong>Your referral code:</strong> ${esc(ref.code)}<br>
       <strong>Your share link:</strong> <a href="${esc(link)}">${esc(link)}</a></p>
       <p>Anyone who signs up through your link (or enters your code) is automatically attributed to you, and they get <strong>${cfg?.referee_discount_percent ?? 20}% off</strong> their first payment.</p>
       <p><strong>How you earn:</strong></p>
       <ul>${terms}</ul>
       <p>${closing}</p>
       <p>The iTrova team</p>`;

    const err = await deliver(ref.email, "Welcome to the iTrova referral program", html, idempotencyKey);
    await stamp("welcome", err);
    if (err) return json({ error: err }, 502);
    return json({ ok: true, to_email: ref.email });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error." }, 500);
  }
});
