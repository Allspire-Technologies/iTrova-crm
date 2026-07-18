// wa.me deep links for messaging a customer on WhatsApp. Same approach as the iTrova app: we open
// WhatsApp with the number + prefilled text; the staff member taps Send. No provider integration.

/** Normalise a phone to WhatsApp's digits-only international form (no +). Handles the common Nigerian
 *  shapes: 0803… → 234803…, 803… (10 digits) → 234803…, +234…/234… kept. Returns "" if it can't. */
export function toWaNumber(raw: string | null | undefined, defaultCc = "234"): string {
  if (!raw) return "";
  let d = raw.replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);          // 00234… → 234…
  if (d.startsWith("0")) d = defaultCc + d.slice(1); // local 0-prefixed → +CC
  else if (d.length <= 10) d = defaultCc + d;        // bare local number → +CC
  return d;
}

/** A number is usable if it's a plausible international length after normalising. */
export function isValidWaNumber(raw: string | null | undefined): boolean {
  const n = toWaNumber(raw);
  return n.length >= 10 && n.length <= 15;
}

/** The number to message a customer on: their WhatsApp number, else the owner's phone. */
export function customerWaNumber(whatsappNumber: string | null | undefined, phone: string | null | undefined): string {
  return isValidWaNumber(whatsappNumber) ? toWaNumber(whatsappNumber) : toWaNumber(phone);
}

/** Build the wa.me deep link (number pre-normalised) with the message text. */
export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
