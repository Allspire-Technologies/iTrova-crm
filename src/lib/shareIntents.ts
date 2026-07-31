// Web share links for posting to the user's ALREADY LOGGED-IN social accounts.
// X/WhatsApp prefill the caption; Facebook/LinkedIn only carry a URL (caption goes via clipboard).
// Instagram has no web share link — only the mobile native share sheet (Web Share API) reaches it.

export type ShareTarget = "x" | "whatsapp" | "facebook" | "linkedin";

export const SHARE_TARGETS: { key: ShareTarget; label: string; prefills: "caption" | "url" }[] = [
  { key: "x", label: "X (Twitter)", prefills: "caption" },
  { key: "whatsapp", label: "WhatsApp", prefills: "caption" },
  { key: "facebook", label: "Facebook", prefills: "url" },
  { key: "linkedin", label: "LinkedIn", prefills: "url" },
];

export function shareUrl(target: ShareTarget, caption: string, linkUrl: string): string {
  switch (target) {
    case "x": return `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`;
    case "whatsapp": return `https://wa.me/?text=${encodeURIComponent(caption)}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(linkUrl)}`;
    case "linkedin": return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(linkUrl)}`;
  }
}

/** Mobile native share sheet with the card image attached (reaches Instagram/any installed app). */
export function canNativeShare(file?: File): boolean {
  if (typeof navigator === "undefined" || !navigator.share) return false;
  if (!file) return true;
  return !!navigator.canShare?.({ files: [file] });
}

export async function nativeShare(caption: string, file?: File): Promise<void> {
  const data: ShareData = file && navigator.canShare?.({ files: [file] })
    ? { text: caption, files: [file] }
    : { text: caption };
  await navigator.share(data);
}
