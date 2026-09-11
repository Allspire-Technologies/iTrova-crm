import { supabase } from "@/integrations/supabase/client";
import { optimizeImage } from "@/lib/imageOptimize";

// Allspire website CMS (as_* tables, migration 20260903110000). Generic row CRUD: the console's
// CollectionTab is schema-driven, so every collection goes through the same four calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type Row = Record<string, unknown> & { id?: string };

export const AS_TABLES = [
  "as_legal_doc",
  "cms_legal_doc",
  "as_logo",
  "as_stat",
  "as_case_study",
  "as_testimonial",
  "as_team_member",
  "as_copy",
  "as_webinar",
  // iTrova website statistics (cms_stat) reuse the same generic editor.
  "cms_stat",
] as const;
export type AsTable = (typeof AS_TABLES)[number];

export async function listRows(table: AsTable, orderBy: string[] = ["sort", "created_at"]): Promise<Row[]> {
  let q = sb.from(table).select("*");
  for (const col of orderBy) q = q.order(col, { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Row[];
}

/**
 * Insert when the row was not loaded with a primary key, otherwise update the row it was loaded
 * as (originalKey), so editing the key itself renames instead of silently updating zero rows.
 */
export async function saveRow(table: AsTable, row: Row, pk: string = "id", originalKey?: unknown): Promise<void> {
  const body = { ...row };
  if (originalKey == null || originalKey === "") {
    if (body[pk] == null || body[pk] === "") delete body[pk];
    const { error } = await sb.from(table).insert(body);
    if (error) throw error;
    return;
  }
  const { data, error } = await sb.from(table).update(body).eq(pk, originalKey).select(pk);
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Nothing was saved. The row may have been deleted; reload and try again.");
}

export async function deleteRow(table: AsTable, key: unknown, pk: string = "id"): Promise<void> {
  const { error } = await sb.from(table).delete().eq(pk, key);
  if (error) throw error;
}

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MEDIA_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/**
 * Upload to the shared cms-media bucket under allspire/<folder>/; returns the public URL.
 * Raster images are downscaled to 1600px and re-encoded as WebP first (see imageOptimize.ts);
 * SVGs pass through untouched.
 */
export async function uploadAllspireMedia(input: File, folder: string): Promise<string> {
  if (!MEDIA_EXT[input.type]) throw new Error("Use a PNG, JPEG, WebP, AVIF or SVG image.");
  const { file } = await optimizeImage(input);
  const ext = MEDIA_EXT[file.type];
  if (file.size > MAX_MEDIA_BYTES) throw new Error("Image is over 5 MB. Resize it and try again.");
  const path = `allspire/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("cms-media").upload(path, file, { cacheControl: "31536000", upsert: false });
  if (error) throw error;
  return supabase.storage.from("cms-media").getPublicUrl(path).data.publicUrl;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}
