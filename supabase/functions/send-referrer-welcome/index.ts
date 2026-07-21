// send-referrer-welcome — emails a newly-registered affiliate/staff referrer their code, share
// link, and what the program entails (built from referral_config). Admin-only. The referrer's
// details + config are read SERVER-SIDE from the code, so the browser only passes the code.
// The Sender token + from-identity live here (Edge Function secrets), never the browser.
//
// Secrets:  supabase secrets set SENDER_API_KEY=... SENDER_FROM_EMAIL=... SENDER_FROM_NAME="iTrova"
// Deploy:   supabase functions deploy send-referrer-welcome
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const senderToken = Deno.env.get("SENDER_API_KEY") ?? Deno.env.get("SENDER_API_TOKEN");
    const fromEmail = Deno.env.get("SENDER_FROM_EMAIL");
    const fromName = Deno.env.get("SENDER_FROM_NAME") ?? "iTrova";
    if (!senderToken || !fromEmail) return json({ error: "Email is not configured (missing SENDER_API_KEY / SENDER_FROM_EMAIL)." }, 500);

    // Caller must be admin (only admins register referrers).
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: role, error: roleErr } = await caller.rpc("cs_my_role");
    if (roleErr) return json({ error: roleErr.message }, 401);
    if (role !== "admin") return json({ error: "Only Management/Admin can send referrer invites." }, 403);

    const { code } = await req.json().catch(() => ({}));
    if (!code || typeof code !== "string") return json({ error: "A referrer code is required." }, 400);

    // Load the referrer + program config server-side.
    const admin = createClient(url, service);
    const { data: ref, error: refErr } = await admin.from("cs_referrer").select("*").eq("code", code.toUpperCase()).maybeSingle();
    if (refErr) return json({ error: refErr.message }, 500);
    if (!ref) return json({ error: "Referrer not found." }, 404);
    if (!ref.email) return json({ error: "This referrer has no email on file." }, 422);
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

    const html =
      `<p>Hi ${esc(ref.name)},</p>
       <p>You're set up as an iTrova ${isAffiliate ? "affiliate" : "referral partner"}. Here's everything you need to start earning.</p>
       <p><strong>Your referral code:</strong> ${esc(ref.code)}<br>
       <strong>Your share link:</strong> <a href="${esc(link)}">${esc(link)}</a></p>
       <p>Anyone who signs up through your link (or enters your code) is automatically attributed to you, and they get <strong>${cfg?.referee_discount_percent ?? 20}% off</strong> their first payment.</p>
       <p><strong>How you earn:</strong></p>
       <ul>${terms}</ul>
       <p>Share your link on WhatsApp, with your network, or anywhere business owners are. Reply to this email if you have any questions.</p>
       <p>— The iTrova team</p>`;

    const res = await fetch("https://api.sender.net/v2/message/send", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${senderToken}` },
      body: JSON.stringify({ from: { email: fromEmail, name: fromName }, to: { email: ref.email, name: ref.name }, subject: "Welcome to the iTrova referral program", html }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: payload?.message ?? payload?.error ?? `Sender returned ${res.status}` }, 502);
    return json({ ok: true, to_email: ref.email });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error." }, 500);
  }
});
