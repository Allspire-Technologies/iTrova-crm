// send-customer-email — the only path that emails a customer. Admin/Support send a one-way
// transactional email to a business's owner. We verify the caller is admin or support (and, for
// support, assigned to the business), resolve the recipient SERVER-SIDE (always the owner's
// account email — the browser never supplies an address), send via Resend's transactional
// API, and log the result to cs_customer_message. The Resend key + from-identity live only
// here (Edge Function secrets), never the browser.
//
// Secrets:  RESEND_API_KEY=re_...  EMAIL_FROM_ADDRESS=no-reply@mail.allspire.tech
//           EMAIL_FROM_NAME="iTrova"  EMAIL_REPLY_TO=<monitored inbox, optional but recommended —
//           the from address is a no-reply, so without this, customer replies bounce>
// Deploy:   supabase functions deploy send-customer-email
// (verify_jwt stays ON — only signed-in users can call it; we additionally require admin/support.)
// Pinned exact version — a floating @2 could silently change behaviour between cold starts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

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
    if (!resendKey || !fromEmail) {
      return json({ error: "Email is not configured (missing RESEND_API_KEY / EMAIL_FROM_ADDRESS)." }, 500);
    }

    // 1) Caller must be admin or support.
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: role, error: roleErr } = await caller.rpc("cs_my_role");
    if (roleErr) return json({ error: roleErr.message }, 401);
    if (role !== "admin" && role !== "support") {
      return json({ error: "Only Management/Admin or Support can email customers." }, 403);
    }

    const { business_id, subject, html, template_key, idempotency_key } = await req.json().catch(() => ({}));
    if (!business_id || typeof business_id !== "string") return json({ error: "A business id is required." }, 400);
    if (!subject || typeof subject !== "string") return json({ error: "A subject is required." }, 400);
    if (!html || typeof html !== "string") return json({ error: "A message body is required." }, 400);

    // Retry-safe sends: our own 15s deadline can fire AFTER Resend accepted the email, so we'd log
    // "failed", the admin would retry, and the customer would get it twice. The compose UI mints a
    // key when a send starts and reuses it until the send succeeds; Resend replays a known key
    // instead of sending again. Namespaced with the business id so one key can't collide across
    // recipients. A malformed/absent key falls back to a fresh UUID — always sent, no replay guard.
    const clientKey = typeof idempotency_key === "string" && /^[A-Za-z0-9-]{8,64}$/.test(idempotency_key)
      ? idempotency_key
      : crypto.randomUUID();
    const idempotencyKey = `cs-${business_id}-${clientKey}`;

    // 2) Support may only message businesses assigned to them.
    if (role !== "admin") {
      const { data: canSee, error: seeErr } = await caller.rpc("cs_can_see_business", { p_business_id: business_id });
      if (seeErr) return json({ error: seeErr.message }, 401);
      if (canSee !== true) return json({ error: "You can only message customers assigned to you." }, 403);
    }

    // 3) Resolve the recipient SERVER-SIDE: always the business owner's account email — the
    //    browser never chooses the address, so a tampered request can't exfiltrate mail elsewhere.
    const admin = createClient(url, service);
    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id, owner_id")
      .eq("id", business_id)
      .maybeSingle();
    if (bizErr) return json({ error: bizErr.message }, 500);
    if (!biz) return json({ error: "Business not found." }, 404);
    const { data: ownerUser, error: ownerErr } = await admin.auth.admin.getUserById(biz.owner_id);
    const to_email = ownerUser?.user?.email ?? null;
    if (ownerErr || !to_email) return json({ error: "This business has no owner email on file." }, 422);
    const { data: profile } = await admin.from("profiles").select("owner_name").eq("id", biz.owner_id).maybeSingle();
    const to_name = profile?.owner_name ?? null;

    // 4) Send via Resend, then log the outcome (service role bypasses RLS on the log table).
    const logRow = {
      business_id,
      to_email,
      to_name,
      subject,
      body: html,
      template_key: template_key ?? null,
      created_by: (await caller.auth.getUser()).data.user?.id ?? null,
    };

    let providerId: string | null = null;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [to_email],
          subject,
          html,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
        // A stalled provider connection must not hold the invocation until the platform kills it.
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = payload?.message ?? payload?.error ?? `Resend returned ${res.status}`;
        const { error: e1 } = await admin.from("cs_customer_message").insert({ ...logRow, status: "failed", error: String(message) });
        if (e1) console.error("cs_customer_message log insert failed (send failed path):", e1.message);
        return json({ error: String(message) }, 502);
      }
      // A 2xx without a message id is not a confirmed send — log it as failed rather than
      // recording "sent" with nothing to trace it by. The idempotency key makes the retry safe.
      if (typeof payload?.id !== "string" || payload.id === "") {
        const message = "Resend accepted the request but returned no message id — delivery unconfirmed, retry is safe.";
        const { error: e3 } = await admin.from("cs_customer_message").insert({ ...logRow, status: "failed", error: message });
        if (e3) console.error("cs_customer_message log insert failed (no-id path):", e3.message);
        return json({ error: message }, 502);
      }
      providerId = payload.id;
    } catch (e) {
      const { error: e2 } = await admin.from("cs_customer_message").insert({ ...logRow, status: "failed", error: (e as Error)?.message ?? "send failed" });
      if (e2) console.error("cs_customer_message log insert failed (provider unreachable path):", e2.message);
      return json({ error: "Couldn't reach the email provider." }, 502);
    }

    const { data: inserted, error: logErr } = await admin
      .from("cs_customer_message")
      .insert({ ...logRow, status: "sent", provider_message_id: providerId })
      .select()
      .single();
    if (logErr) {
      // The email went out but we couldn't record it — surface WHY in the function logs (this is the
      // usual reason the Messages log looks empty) without failing the send for the user.
      console.error("cs_customer_message log insert failed (sent path):", logErr.message);
      return json({ ok: true, id: null, to_email, logged: false });
    }

    return json({ ok: true, id: inserted.id, to_email });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error." }, 500);
  }
});
