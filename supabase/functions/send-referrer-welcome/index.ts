// send-referrer-welcome — emails a newly-registered affiliate/staff referrer their code, share
// link, and what the program entails (built from referral_config). Also sends the polite decline
// for a rejected website application (decision: "rejected" + application_id). When an
// application_id is passed, the outcome is stamped on cs_referrer_application (notified_at /
// notified_kind / notify_error) so the CRM shows delivery state. Admin-only. The referrer's
// details + config are read SERVER-SIDE from the code, so the browser only passes the code.
// The Resend key + from-identity live here (Edge Function secrets), never the browser.
//
// With include_login it ALSO creates the affiliate's dashboard login: it mints a set-password token
// and renders it as a button. The token is minted and used inside this one call, so it never passes
// through the admin's browser. variant "access" sends the short "dashboard is ready" note instead of
// the full welcome, for an affiliate registered before logins existed.
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
// <<< EMAIL SHELL — generated, do not edit here. Source: supabase/functions/_shared/email-shell.ts
// Regenerate with: node scripts/sync-email-shell.mjs
const BRAND = {
  deep: "#085041",
  green: "#1D9E75",
  tint: "#E1F5EE",
  ink: "#33403a",
  muted: "#6b7a73",
  line: "#e6ebe8",
  page: "#e9ecea",
};
const SITE = "https://itrova.co";
const SYS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY_FONT = `'Syne',${SYS}`;
const BODY_FONT = `'DM Sans',${SYS}`;

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Primary call-to-action. The mso branch renders a real button in Outlook for Windows, which
 *  ignores border-radius and padding on an anchor and would otherwise show a bare blue link. */
function emailButton(href: string, label: string): string {
  const w = Math.max(180, label.length * 10 + 60);
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(href)}" style="height:48px;v-text-anchor:middle;width:${w}px;" arcsize="18%" stroke="f" fillcolor="${BRAND.green}">
<w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${esc(label)}</center></v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${esc(href)}" style="display:inline-block;background:${BRAND.green};color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:9px;font-family:${DISPLAY_FONT};">${esc(label)}</a>
<!--<![endif]-->`;
}

/** A tinted panel for the one detail the reader came for (a code, a link, an amount). */
function emailPanel(rows: { label: string; value: string }[]): string {
  const body = rows.map((r, i) => `
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0d6b52;font-weight:700;margin-bottom:5px;${i ? "margin-top:14px;" : ""}">${esc(r.label)}</div>
          <div style="font-size:15px;color:${BRAND.deep};word-break:break-all;">${r.value}</div>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.tint};border-radius:10px;">
        <tr><td style="padding:18px 20px;border-left:3px solid ${BRAND.green};border-radius:10px;font-family:${BODY_FONT};">${body}
        </td></tr>
      </table>`;
}

/** Wraps body HTML in the branded shell. `preheader` is the grey line inboxes show after the
 *  subject; without one they scrape the first visible text, which is usually the greeting. */
function emailShell(o: { title: string; preheader: string; body: string; footerNote?: string }): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(o.title)}</title>
<style>
@font-face{font-family:'Syne';src:url('${SITE}/fonts/syne-latin-v1.woff2') format('woff2');font-weight:500 800;font-display:swap;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD;}
@font-face{font-family:'Syne';src:url('${SITE}/fonts/syne-latin-ext-v1.woff2') format('woff2');font-weight:500 800;font-display:swap;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF;}
@font-face{font-family:'DM Sans';src:url('${SITE}/fonts/dm-sans-latin-v1.woff2') format('woff2');font-weight:400 700;font-display:swap;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD;}
@font-face{font-family:'DM Sans';src:url('${SITE}/fonts/dm-sans-latin-ext-v1.woff2') format('woff2');font-weight:400 700;font-display:swap;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF;}
body{margin:0;padding:0;background:${BRAND.page};}
@media only screen and (max-width:620px){.wrap{width:100%!important;}.pad{padding-left:20px!important;padding-right:20px!important;}}
</style>
<!--[if mso]><style>*{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${BRAND.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dfe5e2;">
    <tr><td style="height:4px;line-height:4px;font-size:0;background:${BRAND.green};">&nbsp;</td></tr>
    <tr><td bgcolor="#ffffff" class="pad" style="background:#ffffff;padding:18px 32px;border-bottom:1px solid ${BRAND.line};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:10px;line-height:0;"><img src="${SITE}/icon-512.png" width="34" height="34" alt="" style="display:block;width:34px;height:34px;border:0;"></td>
        <td style="font-family:${DISPLAY_FONT};font-size:20px;font-weight:700;color:${BRAND.deep};letter-spacing:-0.2px;">iTrova</td>
      </tr></table>
    </td></tr>
    <tr><td class="pad" style="padding:28px 32px 26px;font-family:${BODY_FONT};">
      <div style="font-family:${DISPLAY_FONT};font-size:21px;line-height:1.3;font-weight:700;color:${BRAND.deep};margin:0 0 14px;">${esc(o.title)}</div>
${o.body}
    </td></tr>
    <tr><td bgcolor="#f7f9f8" class="pad" style="background:#f7f9f8;padding:18px 32px;border-top:1px solid ${BRAND.line};font-family:${BODY_FONT};">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#7c8a83;">iTrova by Allspire Technologies Limited &middot; RC 9702176${o.footerNote ? "<br>" + esc(o.footerNote) : ""}</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** Body paragraph, sized and coloured for the shell. */
const p = (html: string) =>
  `      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BRAND.ink};font-family:${BODY_FONT};">${html}</p>`;

/** Small print under a call to action. */
const small = (html: string) =>
  `      <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:${BRAND.muted};font-family:${BODY_FONT};">${html}</p>`;

/** Sub-heading inside the body. */
const h2 = (text: string) =>
  `      <div style="font-family:${DISPLAY_FONT};font-size:15px;font-weight:700;color:${BRAND.deep};margin:22px 0 6px;">${esc(text)}</div>`;

/** A plain-text alternative. Sending HTML alone is a well known spam signal, so every send should
 *  carry both parts. Collapses tags to text; block elements become line breaks. */
function toPlainText(html: string): string {
  const entities: Record<string, string> = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'",
    middot: "·", bull: "-", hellip: "...", mdash: "-", ndash: "-", rsquo: "'", lsquo: "'",
    rarr: "->", larr: "<-", copy: "(c)", trade: "(TM)", reg: "(R)", ldquo: '"', rdquo: '"',
  };
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // The preheader is a display-only device that duplicates the subject line.
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, "")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const label = String(text).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
      const url = String(href).replace(/&amp;/g, "&");
      return label && label !== url ? `${label} (${url})` : url;
    })
    .replace(/<li[^>]*>/gi, "\n- ")
    // Cells join on one line; rows and blocks break.
    .replace(/<\/t[dh]>\s*/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => entities[String(name).toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
// >>> END EMAIL SHELL
const money = (n: number) => "₦" + Number(n || 0).toLocaleString();

const DEFAULT_APP_URL = "https://itrova.allspire.tech";

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

    // Where emailed links point. Deployment configuration, not business data, so it lives beside the
    // other secrets. Must be https: these links carry sign-in tokens and referral attribution.
    const appUrl = (Deno.env.get("ITROVA_APP_URL") ?? DEFAULT_APP_URL).replace(/\/+$/, "");
    let appOrigin: URL;
    try { appOrigin = new URL(appUrl); } catch { return json({ error: "ITROVA_APP_URL is not a valid URL." }, 500); }
    const localDev = appOrigin.hostname === "localhost" || appOrigin.hostname === "127.0.0.1";
    if (appOrigin.protocol !== "https:" && !(appOrigin.protocol === "http:" && localDev)) {
      return json({ error: "ITROVA_APP_URL must be an https URL." }, 500);
    }
    const SIGNUP_BASE = `${appUrl}/auth`;

    // Caller must be admin (only admins register referrers).
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: role, error: roleErr } = await caller.rpc("cs_my_role");
    if (roleErr) return json({ error: roleErr.message }, 401);
    if (role !== "admin") return json({ error: "Only Management/Admin can send referrer invites." }, 403);

    const { code, idempotency_key, application_id, decision, include_login, variant } = await req.json().catch(() => ({}));
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
        const { error: stampErr } = await admin.from("cs_referrer_application")
          .update({ notified_at: error ? null : new Date().toISOString(), notified_kind: kind, notify_error: error })
          .eq("id", appId);
        if (stampErr) console.error("send-referrer-welcome: outcome stamp failed", stampErr.message);
      } catch (e) { console.error("send-referrer-welcome: outcome stamp threw", (e as Error)?.message); }
    };

    const deliver = async (to: string, subject: string, html: string, idempotencyKey: string): Promise<string | null> => {
      let res: Response;
      try {
        res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}`, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to], subject, html, text: toPlainText(html), ...(replyTo ? { reply_to: replyTo } : {}) }),
        // A stalled provider connection must not hold the invocation until the platform kills it.
        signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        return (e as Error)?.name === "TimeoutError" ? "Email provider timed out (15s)." : `Couldn't reach the email provider: ${(e as Error)?.message ?? "network error"}`;
      }
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
      const declineHtml = emailShell({
        title: "Your iTrova affiliate application",
        preheader: "An update on the application you sent us.",
        body:
          p(`Hi ${esc(app.name)},`) +
          p("Thank you for applying to the iTrova affiliate program. After reviewing your application, we are not able to bring you on board at this time.") +
          p(esc(closingDecline)) +
          p("The iTrova team"),
      });
      const err = await deliver(app.email, "Your iTrova affiliate application", declineHtml, `app-${appId}-decline`);
      await stamp("decline", err);
      if (err) return json({ error: err }, 502);
      return json({ ok: true, to_email: app.email });
    }

    // ---- Welcome path: a registered referrer ----
    if (!code || typeof code !== "string") return json({ error: "A referrer code is required." }, 400);
    // Application-backed welcomes get a deterministic key (durable across remounts/devices);
    // registry-form welcomes keep the client's per-attempt-series key.
    let idempotencyKey = appId
      ? `app-${appId}-welcome`
      : `ref-${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${clientKey}`;

    // Load the referrer + program config server-side.
    const { data: ref, error: refErr } = await admin.from("cs_referrer").select("*").eq("code", code.toUpperCase()).maybeSingle();
    if (refErr) return json({ error: refErr.message }, 500);
    if (!ref) return json({ error: "Referrer not found." }, 404);
    if (!ref.email) { await stamp("welcome", "No email on file"); return json({ error: "This referrer has no email on file." }, 422); }
    // The share and discount are a commitment about money, so a missing config must stop the send
    // rather than fall back to a figure that may not match the programme's actual terms.
    const { data: cfg, error: cfgErr } = await admin.from("referral_config").select("*").maybeSingle();
    if (cfgErr) return json({ error: cfgErr.message }, 500);
    if (!cfg) return json({ error: "The referral programme settings could not be read, so no terms were sent." }, 500);

    const share = ref.share_percent ?? cfg.affiliate_share_percent;
    const staffBonus = (cfg.staff_bonus ?? {}) as Record<string, number>;
    const link = `${SIGNUP_BASE}?ref=${encodeURIComponent(ref.code)}`;
    const isAffiliate = ref.kind === "affiliate";

    // ---- Dashboard login (optional) ----
    const wantsLogin = include_login === true;
    let setPasswordUrl: string | null = null;
    if (wantsLogin) {
      if (!isAffiliate) return json({ error: "Only affiliates get a dashboard login." }, 422);
      if (!ref.active) return json({ error: "This affiliate is deactivated, so it has no dashboard access." }, 422);
      // invite_token is what stops iTrova's handle_new_user trigger creating a business for this
      // account; the value names the kind of account so the metadata is not misleading.
      const invite = await admin.auth.admin.generateLink({
        type: "invite",
        email: ref.email,
        options: { data: { invite_token: "affiliate", affiliate_code: ref.code, full_name: ref.name } },
      });
      let userId = invite.data?.user?.id;
      let tokenHash = invite.data?.properties?.hashed_token;
      let linkType = "invite";
      if (invite.error) {
        // Already has an account (re-issuing a link): a recovery link sets a password just the same.
        const recovery = await admin.auth.admin.generateLink({ type: "recovery", email: ref.email });
        if (recovery.error) return json({ error: invite.error.message }, 400);
        userId = recovery.data?.user?.id;
        tokenHash = recovery.data?.properties?.hashed_token;
        linkType = "recovery";
      }
      if (!userId || !tokenHash) return json({ error: "Could not generate the sign-in link." }, 500);
      const linked = await admin.from("cs_referrer").update({ user_id: userId }).eq("code", ref.code);
      if (linked.error) return json({ error: linked.error.message }, 500);
      setPasswordUrl = `${appUrl}/affiliates/set-password?token_hash=${encodeURIComponent(tokenHash)}&type=${linkType}`;
      // Minting a token invalidates the previous one, so this email must really be sent rather than
      // replayed from the provider's cache: its key is tied to the token it carries.
      idempotencyKey = `login-${ref.code}-${tokenHash.slice(0, 32)}`;
    }
    const loginBlock = setPasswordUrl
      ? h2("Your affiliate dashboard") +
        p("See who you have referred, what you have earned and what we have paid you.") +
        `      <div style="margin:18px 0 0;">${emailButton(setPasswordUrl, "Set your password")}</div>` +
        small(`Or copy this address into your browser:<br><a href="${esc(setPasswordUrl)}" style="color:#0d6b52;word-break:break-all;">${esc(setPasswordUrl)}</a>`) +
        small(`You sign in at <a href="${esc(appUrl)}/affiliates/login" style="color:#0d6b52;">${esc(appUrl)}/affiliates/login</a> with <strong style="color:${BRAND.ink};">${esc(ref.email)}</strong>. Your referral code is for sharing, not for signing in.`)
      : "";
    const accessOnly = wantsLogin && variant === "access";

    const bullet = (html: string) =>
      `<tr><td valign="top" style="padding:0 8px 7px 0;color:${BRAND.green};font-size:15px;line-height:1.6;font-family:${BODY_FONT};">&bull;</td>
           <td style="padding-bottom:7px;font-size:15px;line-height:1.6;color:${BRAND.ink};font-family:${BODY_FONT};">${html}</td></tr>`;
    const terms = isAffiliate
      ? bullet(`You earn <strong style="color:${BRAND.deep};">${share}%</strong> of everything a business you refer pays in their first 12 months.`) +
        bullet("Rewards are paid once the business makes its first payment.")
      : bullet(`You earn a bonus for each business you refer that subscribes: Pro ${money(staffBonus.pro ?? 0)}, Business ${money(staffBonus.business ?? 0)}, Enterprise ${money(staffBonus.enterprise ?? 0)}.`) +
        bullet("Bonuses are paid once the referred business makes its first payment.");

    // "Reply to this email" is only promised when a monitored reply-to is configured — the from
    // address is a no-reply, and inviting replies into a void is worse than not inviting them.
    const closing = replyTo
      ? "Share your link on WhatsApp, with your network, or anywhere business owners are. Reply to this email if you have any questions."
      : "Share your link on WhatsApp, with your network, or anywhere business owners are.";

    const welcomeBody =
      p(`Hi ${esc(ref.name)},`) +
      p(`You're set up as an iTrova ${isAffiliate ? "affiliate" : "referral partner"}. Here is everything you need to start earning. Anyone who signs up through your link is attributed to you automatically, and they get <strong style="color:${BRAND.deep};">${cfg.referee_discount_percent}% off</strong> their first payment.`) +
      `      <div style="margin:18px 0;">${emailPanel([
        { label: "Your referral code", value: `<span style="font-size:22px;font-weight:700;letter-spacing:1.5px;font-family:'SF Mono',Consolas,monospace;">${esc(ref.code)}</span>` },
        { label: "Your share link", value: `<a href="${esc(link)}" style="color:#0d6b52;text-decoration:underline;">${esc(link)}</a>` },
      ])}</div>` +
      h2("How you earn") +
      `      <table role="presentation" cellpadding="0" cellspacing="0" border="0">${terms}</table>`;

    const html = accessOnly
      ? emailShell({
          title: "Your affiliate dashboard is ready",
          preheader: "Set a password and see your referrals, earnings and payouts.",
          footerNote: "You are receiving this because you joined the iTrova referral program.",
          body: p(`Hi ${esc(ref.name)},`) + loginBlock + `      <div style="margin-top:22px;">` + p("The iTrova team") + `</div>`,
        })
      : emailShell({
          title: `You are set up as an iTrova ${isAffiliate ? "affiliate" : "referral partner"}`,
          preheader: "Your referral code, your share link and how you get paid.",
          footerNote: "You are receiving this because you joined the iTrova referral program.",
          body: welcomeBody + loginBlock + `      <div style="margin-top:22px;">` + p(esc(closing)) + p("The iTrova team") + `</div>`,
        });

    const err = await deliver(ref.email, accessOnly ? "Your iTrova affiliate dashboard is ready" : "Welcome to the iTrova referral program", html, idempotencyKey);
    await stamp("welcome", err);
    if (err) return json({ error: err }, 502);
    return json({ ok: true, to_email: ref.email });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error." }, 500);
  }
});
