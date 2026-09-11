// CANONICAL SOURCE for the iTrova transactional email shell.
//
// This file is NOT imported at runtime. Edge Functions here are deployed by pasting one whole file
// into the Supabase dashboard editor, so every function must stay self-contained. Each of them
// carries its own copy of the block below, marked with the same banner comment.
//
// When you change anything here, update all copies and re-paste every affected function:
//   send-referrer-welcome, resend-activation-email, send-customer-email
//
// Why the markup looks like this: email clients are not browsers. Layout is tables, styling is
// inline, and anything in <style> is a progressive enhancement that Gmail's mobile apps may drop.
// Brand fonts load in Apple Mail, Outlook for Mac, Samsung Mail and Thunderbird; Gmail and Outlook
// on Windows refuse remote fonts and get the system stack, which is why every element also names a
// full fallback. The mso block forces Arial on Outlook for Windows, which otherwise falls back to a
// serif when it meets a font name it does not know.

export const BRAND = {
  deep: "#085041",
  green: "#1D9E75",
  tint: "#E1F5EE",
  ink: "#33403a",
  muted: "#6b7a73",
  line: "#e6ebe8",
  page: "#e9ecea",
};
export const SITE = "https://itrova.co";
const SYS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const DISPLAY_FONT = `'Syne',${SYS}`;
export const BODY_FONT = `'DM Sans',${SYS}`;

export const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Primary call-to-action. The mso branch renders a real button in Outlook for Windows, which
 *  ignores border-radius and padding on an anchor and would otherwise show a bare blue link. */
export function emailButton(href: string, label: string): string {
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
export function emailPanel(rows: { label: string; value: string }[]): string {
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
export function emailShell(o: { title: string; preheader: string; body: string; footerNote?: string }): string {
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
export const p = (html: string) =>
  `      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BRAND.ink};font-family:${BODY_FONT};">${html}</p>`;

/** Small print under a call to action. */
export const small = (html: string) =>
  `      <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:${BRAND.muted};font-family:${BODY_FONT};">${html}</p>`;

/** Sub-heading inside the body. */
export const h2 = (text: string) =>
  `      <div style="font-family:${DISPLAY_FONT};font-size:15px;font-weight:700;color:${BRAND.deep};margin:22px 0 6px;">${esc(text)}</div>`;

/** A plain-text alternative. Sending HTML alone is a well known spam signal, so every send should
 *  carry both parts. Collapses tags to text; block elements become line breaks. */
export function toPlainText(html: string): string {
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
