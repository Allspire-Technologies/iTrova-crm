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

    // The composer produces a fragment. Wrap it in the branded shell for sending; the log above
    // deliberately keeps the raw composed body, which is what the staff member actually wrote.
    const wrappedHtml = emailShell({
      title: subject,
      preheader: toPlainText(html).slice(0, 110),
      body: `      <div style="font-family:${BODY_FONT};font-size:15px;line-height:1.65;color:${BRAND.ink};">${html}</div>`,
    });
    const plainText = toPlainText(wrappedHtml);

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
          html: wrappedHtml,
          text: plainText,
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
