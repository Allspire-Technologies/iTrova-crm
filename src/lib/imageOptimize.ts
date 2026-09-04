// Client-side image optimisation for CMS uploads: raster images are downscaled to a sensible
// display width and re-encoded as WebP before they reach storage, so every cover, logo and
// photo the sites serve is light without the editor thinking about it. SVG, GIF and anything
// the browser cannot decode pass through untouched, as does an image the conversion would
// not make smaller.

export const OPTIMIZE_MAX_WIDTH = 1600;
export const OPTIMIZE_QUALITY = 0.85;

const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

export interface OptimizedImage {
  file: File;
  /** Whether the file was re-encoded (false: original returned unchanged). */
  converted: boolean;
  width: number;
  height: number;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall back to an <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return "naturalWidth" in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

/**
 * Downscale to at most `maxWidth` px wide (aspect preserved) and encode as WebP. Returns the
 * original file when it is not a raster image, cannot be decoded, or would not get smaller.
 */
export async function optimizeImage(file: File, maxWidth = OPTIMIZE_MAX_WIDTH, quality = OPTIMIZE_QUALITY): Promise<OptimizedImage> {
  const passthrough = (w = 0, h = 0): OptimizedImage => ({ file, converted: false, width: w, height: h });
  if (!RASTER.has(file.type) || typeof document === "undefined") return passthrough();
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await decode(file);
  } catch {
    return passthrough();
  }
  const { w, h } = sizeOf(src);
  if (!w || !h) return passthrough();
  const scale = w > maxWidth ? maxWidth / w : 1;
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return passthrough(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, width, height);
  if ("close" in src) src.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  // Keep the original when the browser cannot encode WebP or the result is not actually smaller
  // (already-optimised WebP/AVIF at or below the target width).
  if (!blob || blob.type !== "image/webp" || (scale === 1 && blob.size >= file.size)) return passthrough(w, h);
  const name = file.name.replace(/\.[a-z0-9]+$/i, "") + ".webp";
  return { file: new File([blob], name, { type: "image/webp" }), converted: true, width, height };
}
