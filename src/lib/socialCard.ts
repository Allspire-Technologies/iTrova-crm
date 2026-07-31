// Renders the branded 1080×1080 text-card for a post on a canvas (download / mobile share sheet).

const BRAND = { bg: "#0b3d2e", accent: "#34d399", text: "#ffffff", sub: "rgba(255,255,255,0.72)" };

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (ctx.measureText(probe).width > maxWidth && line) { lines.push(line); line = w; }
    else line = probe;
  }
  if (line) lines.push(line);
  return lines.slice(0, 6);
}

export function renderCard(cardText: string, footer: string): HTMLCanvasElement {
  const size = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = BRAND.accent;
  ctx.beginPath(); ctx.arc(size - 80, 90, 180, 0, Math.PI * 2); ctx.globalAlpha = 0.12; ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = BRAND.accent;
  ctx.font = "bold 44px system-ui, sans-serif";
  ctx.fillText("iTrova", 90, 130);
  ctx.fillStyle = BRAND.sub;
  ctx.font = "28px system-ui, sans-serif";
  ctx.fillText("by Allspire", 240, 130);

  ctx.fillStyle = BRAND.text;
  ctx.font = "bold 78px system-ui, sans-serif";
  const lines = wrapText(ctx, cardText, size - 180);
  const lineH = 96;
  const startY = size / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, 90, startY + i * lineH));

  ctx.fillStyle = BRAND.accent;
  ctx.fillRect(90, size - 150, 70, 8);
  ctx.fillStyle = BRAND.sub;
  ctx.font = "34px system-ui, sans-serif";
  ctx.fillText(footer, 90, size - 90);

  return canvas;
}

export function cardDataUrl(cardText: string, footer: string): string {
  return renderCard(cardText, footer).toDataURL("image/png");
}

export async function cardFile(cardText: string, footer: string, name = "itrova-card.png"): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    renderCard(cardText, footer).toBlob(b => (b ? resolve(b) : reject(new Error("Card render failed"))), "image/png"));
  return new File([blob], name, { type: "image/png" });
}

export function downloadCard(cardText: string, footer: string, name = "itrova-card.png") {
  const a = document.createElement("a");
  a.href = cardDataUrl(cardText, footer);
  a.download = name;
  a.click();
}
