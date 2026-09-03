import { supabase } from "@/integrations/supabase/client";

// Allspire website CMS (as_* tables, migration 20260903110000). Generic row CRUD: the console's
// CollectionTab is schema-driven, so every collection goes through the same four calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type Row = Record<string, unknown> & { id?: string };

export const AS_TABLES = [
  "as_logo",
  "as_stat",
  "as_case_study",
  "as_testimonial",
  "as_team_member",
  "as_copy",
  "as_webinar",
] as const;
export type AsTable = (typeof AS_TABLES)[number];

export async function listRows(table: AsTable, orderBy: string[] = ["sort", "created_at"]): Promise<Row[]> {
  let q = sb.from(table).select("*");
  for (const col of orderBy) q = q.order(col, { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Row[];
}

/** Insert when there is no primary key value yet, otherwise update by that key. */
export async function saveRow(table: AsTable, row: Row, pk: string = "id"): Promise<void> {
  const key = row[pk];
  const body = { ...row };
  if (key == null || key === "") delete body[pk];
  const q = key == null || key === "" ? sb.from(table).insert(body) : sb.from(table).update(body).eq(pk, key);
  const { error } = await q;
  if (error) throw error;
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

/** Upload to the shared cms-media bucket under allspire/<folder>/; returns the public URL. */
export async function uploadAllspireMedia(file: File, folder: string): Promise<string> {
  const ext = MEDIA_EXT[file.type];
  if (!ext) throw new Error("Use a PNG, JPEG, WebP, AVIF or SVG image.");
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
