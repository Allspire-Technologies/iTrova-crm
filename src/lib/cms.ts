import { supabase } from "@/integrations/supabase/client";

// Website CMS content (cms_* tables, migration 20260902100000). Authored here in the CRM,
// read by the itrova marketing website (published rows only; RLS enforces). The cms_* tables
// postdate any generated types, so everything goes through the usual single cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface ChangelogEntry {
  id: string;
  entryDate: string;
  title: string;
  tag: "New" | "Improved" | null;
  items: string[];
  published: boolean;
  sort: number;
  updatedAt: string;
}

export interface CmsPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMd: string;
  coverUrl: string | null;
  tags: string[];
  author: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface CmsTestimonial {
  id: string;
  name: string;
  business: string;
  quote: string;
  published: boolean;
  sort: number;
}

export interface CmsCopy {
  key: string;
  value: unknown;
  published: boolean;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapChangelog = (r: any): ChangelogEntry => ({
  id: r.id,
  entryDate: r.entry_date,
  title: r.title,
  tag: r.tag ?? null,
  items: Array.isArray(r.items) ? r.items : [],
  published: !!r.published,
  sort: r.sort ?? 0,
  updatedAt: r.updated_at,
});

const mapPost = (r: any): CmsPost => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  excerpt: r.excerpt ?? null,
  bodyMd: r.body_md ?? "",
  coverUrl: r.cover_url ?? null,
  tags: r.tags ?? [],
  author: r.author ?? null,
  publishedAt: r.published_at ?? null,
  updatedAt: r.updated_at,
});

const mapTestimonial = (r: any): CmsTestimonial => ({
  id: r.id,
  name: r.name,
  business: r.business,
  quote: r.quote,
  published: !!r.published,
  sort: r.sort ?? 0,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listChangelog(): Promise<ChangelogEntry[]> {
  const { data, error } = await sb
    .from("cms_changelog")
    .select("*")
    .order("sort", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapChangelog);
}

export async function saveChangelog(entry: {
  id?: string;
  entryDate: string;
  title: string;
  tag: "New" | "Improved" | null;
  items: string[];
  published: boolean;
  sort: number;
}): Promise<void> {
  const row = {
    entry_date: entry.entryDate,
    title: entry.title,
    tag: entry.tag,
    items: entry.items,
    published: entry.published,
    sort: entry.sort,
  };
  const q = entry.id
    ? sb.from("cms_changelog").update(row).eq("id", entry.id)
    : sb.from("cms_changelog").insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function deleteChangelog(id: string): Promise<void> {
  const { error } = await sb.from("cms_changelog").delete().eq("id", id);
  if (error) throw error;
}

export async function listPosts(): Promise<CmsPost[]> {
  const { data, error } = await sb
    .from("cms_post")
    .select("*")
    .order("published_at", { ascending: false, nullsFirst: true })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapPost);
}

export async function savePost(post: {
  id?: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMd: string;
  coverUrl: string;
  tags: string[];
  author: string;
  publishedAt: string | null;
}): Promise<void> {
  const row = {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt || null,
    body_md: post.bodyMd,
    cover_url: post.coverUrl || null,
    tags: post.tags,
    author: post.author || null,
    published_at: post.publishedAt,
  };
  const q = post.id ? sb.from("cms_post").update(row).eq("id", post.id) : sb.from("cms_post").insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function deletePost(id: string): Promise<void> {
  const { data } = await sb.from("cms_post").select("cover_url").eq("id", id).maybeSingle();
  const { error } = await sb.from("cms_post").delete().eq("id", id);
  if (error) throw error;
  if (data?.cover_url) void removeCmsMedia(data.cover_url);
}

const MEDIA_PUBLIC_PREFIX = "/storage/v1/object/public/cms-media/";

/** Best-effort removal of a cms-media object by its public URL. Ignores URLs outside the
 *  bucket and swallows failures: cleanup must never mask the operation that triggered it. */
export async function removeCmsMedia(url: string): Promise<void> {
  try {
    const path = new URL(url).pathname;
    const idx = path.indexOf(MEDIA_PUBLIC_PREFIX);
    if (idx === -1) return;
    const objectPath = decodeURIComponent(path.slice(idx + MEDIA_PUBLIC_PREFIX.length));
    if (objectPath) await supabase.storage.from("cms-media").remove([objectPath]);
  } catch {
    /* best-effort */
  }
}

export async function listTestimonials(): Promise<CmsTestimonial[]> {
  const { data, error } = await sb
    .from("cms_testimonial")
    .select("*")
    .order("sort", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapTestimonial);
}

export async function saveTestimonial(t: {
  id?: string;
  name: string;
  business: string;
  quote: string;
  published: boolean;
  sort: number;
}): Promise<void> {
  const row = { name: t.name, business: t.business, quote: t.quote, published: t.published, sort: t.sort };
  const q = t.id ? sb.from("cms_testimonial").update(row).eq("id", t.id) : sb.from("cms_testimonial").insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function deleteTestimonial(id: string): Promise<void> {
  const { error } = await sb.from("cms_testimonial").delete().eq("id", id);
  if (error) throw error;
}

export async function listCopy(): Promise<CmsCopy[]> {
  const { data, error } = await sb.from("cms_copy").select("*").order("key");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    key: r.key,
    value: r.value,
    published: !!r.published,
    updatedAt: r.updated_at,
  }));
}

export async function saveCopy(key: string, value: unknown, published: boolean): Promise<void> {
  const { error } = await sb.from("cms_copy").upsert({ key, value, published });
  if (error) throw error;
}

export async function deleteCopy(key: string): Promise<void> {
  const { error } = await sb.from("cms_copy").delete().eq("key", key);
  if (error) throw error;
}

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MEDIA_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Upload a blog cover to the public cms-media bucket; returns the public URL.
 *  Type/size are checked here AND enforced on the bucket itself (see the cms migration). */
export async function uploadCmsMedia(file: File): Promise<string> {
  const ext = MEDIA_EXT[file.type];
  if (!ext) throw new Error("Use a PNG, JPEG, WebP or AVIF image.");
  if (file.size > MAX_MEDIA_BYTES) throw new Error("Image is over 5 MB. Resize it and try again.");
  const path = `covers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("cms-media").upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("cms-media").getPublicUrl(path);
  return data.publicUrl;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}
