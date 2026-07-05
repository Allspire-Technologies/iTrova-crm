// send-customer-email — the only path that emails a customer. Admin/Support send a one-way
// transactional email to a business's owner. We verify the caller is admin or support (and, for
// support, assigned to the business), resolve the recipient SERVER-SIDE (always the owner's
// account email — the browser never supplies an address), send via Sender.net's transactional
// API, and log the result to cs_customer_message. The Sender token + from-identity live only
// here (Edge Function secrets), never the browser.
//
// Secrets:  supabase secrets set SENDER_API_KEY=... SENDER_FROM_EMAIL=... SENDER_FROM_NAME="iTrova"
// Deploy:   supabase functions deploy send-customer-email
// (verify_jwt stays ON — only signed-in users can call it; we additionally require admin/support.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    // The token secret is stored as SENDER_API_KEY in this project (SENDER_API_TOKEN also accepted).
    const senderToken = Deno.env.get("SENDER_API_KEY") ?? Deno.env.get("SENDER_API_TOKEN");
    const fromEmail = Deno.env.get("SENDER_FROM_EMAIL");
    const fromName = Deno.env.get("SENDER_FROM_NAME") ?? "iTrova";
    if (!senderToken || !fromEmail) {
      return json({ error: "Email is not configured (missing SENDER_API_KEY / SENDER_FROM_EMAIL)." }, 500);
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

    const { business_id, subject, html, template_key } = await req.json().catch(() => ({}));
    if (!business_id || typeof business_id !== "string") return json({ error: "A business id is required." }, 400);
    if (!subject || typeof subject !== "string") return json({ error: "A subject is required." }, 400);
    if (!html || typeof html !== "string") return json({ error: "A message body is required." }, 400);

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

    // 4) Send via Sender.net, then log the outcome (service role bypasses RLS on the log table).
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
      const res = await fetch("https://api.sender.net/v2/message/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${senderToken}`,
        },
        body: JSON.stringify({
          from: { email: fromEmail, name: fromName },
          to: { email: to_email, name: to_name ?? undefined },
          subject,
          html,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = payload?.message ?? payload?.error ?? `Sender returned ${res.status}`;
        await admin.from("cs_customer_message").insert({ ...logRow, status: "failed", error: String(message) });
        return json({ error: String(message) }, 502);
      }
      providerId = payload?.data?.id ?? payload?.id ?? null;
    } catch (e) {
      await admin.from("cs_customer_message").insert({ ...logRow, status: "failed", error: (e as Error)?.message ?? "send failed" });
      return json({ error: "Couldn't reach the email provider." }, 502);
    }

    const { data: inserted, error: logErr } = await admin
      .from("cs_customer_message")
      .insert({ ...logRow, status: "sent", provider_message_id: providerId })
      .select()
      .single();
    if (logErr) return json({ ok: true, id: null, to_email }); // email sent; logging failed — don't fail the send

    return json({ ok: true, id: inserted.id, to_email });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error." }, 500);
  }
});
