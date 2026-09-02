import { ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import {
  ChangelogEntry,
  CmsPost,
  CmsCopy,
  CmsTestimonial,
  deleteChangelog,
  deleteCopy,
  deletePost,
  deleteTestimonial,
  listChangelog,
  listCopy,
  listPosts,
  listTestimonials,
  removeCmsMedia,
  saveChangelog,
  saveCopy,
  savePost,
  saveTestimonial,
  slugify,
  uploadCmsMedia,
} from "@/lib/cms";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// Website content console: what the itrova marketing site renders (published rows only).
// Guide-section editing ships in a follow-up; the table exists, the site falls back to its
// built-in guide until then.

const TABS = [
  { key: "changelog", label: "What's new" },
  { key: "posts", label: "Blog" },
  { key: "testimonials", label: "Testimonials" },
  { key: "copy", label: "Page copy" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const PUBLISHED_PILL = "rounded-full px-2 py-0.5 text-xs font-medium";
function PublishedPill({ on, offLabel = "Draft" }: { on: boolean; offLabel?: string }) {
  return (
    <span
      className={cn(
        PUBLISHED_PILL,
        on ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground",
      )}
    >
      {on ? "Published" : offLabel}
    </span>
  );
}

// Shared accessible shell for the editor dialogs: labelled dialog semantics, Escape closes,
// first field focused on open, focus restored on close. Click-outside still closes.
function EditorShell({
  title,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const FOCUSABLE =
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    ref.current
      ?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")
      ?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const inside = !!active && !!ref.current?.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "max-h-[90vh] w-full space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-5",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="font-display text-lg font-semibold text-brand-dark">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

export default function Website() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<TabKey>("changelog");

  const onTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.key === tab);
    const next = TABS[(idx + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.key);
    (e.currentTarget.querySelector(`#tab-${next.key}`) as HTMLElement | null)?.focus();
  };

  return (
    <div>
      <PageHeader
        title="Website"
        subtitle="Content on itrova's marketing site. Only published rows are visible to the public."
      />
      <div
        role="tablist"
        aria-label="Website content sections"
        onKeyDown={onTablistKeyDown}
        className="mb-6 flex flex-wrap gap-1 border-b border-border/60"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-brand text-brand-dark"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "changelog" && <ChangelogTab isAdmin={isAdmin} />}
        {tab === "posts" && <PostsTab isAdmin={isAdmin} />}
        {tab === "testimonials" && <TestimonialsTab isAdmin={isAdmin} />}
        {tab === "copy" && <CopyTab isAdmin={isAdmin} />}
      </div>
    </div>
  );
}

/* ------------------------------- What's new ------------------------------- */

function ChangelogTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<ChangelogEntry[] | null>(null);
  const [editing, setEditing] = useState<ChangelogEntry | "new" | null>(null);
  const [removing, setRemoving] = useState<ChangelogEntry | null>(null);

  const reload = useCallback(() => {
    listChangelog().then(setRows).catch((e) => {
      setRows([]);
      toast.error(msg(e));
    });
  }, []);
  useEffect(reload, [reload]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The site shows the newest three published entries.
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> New entry
          </Button>
        )}
      </div>
      {rows == null ? (
        <LoadingState />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead className="text-right tabular-nums">Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No entries yet. The site falls back to its built-in changelog until the first
                    published entry.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{r.entryDate}</TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>{r.tag ?? "·"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.items.length}</TableCell>
                  <TableCell>
                    <PublishedPill on={r.published} />
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <ChangelogDialog
          entry={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title="Delete this entry?"
          description={`"${removing.title}" will disappear from the site immediately.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            try {
              await deleteChangelog(removing.id);
              toast.success("Entry deleted");
              setRemoving(null);
              reload();
            } catch (e) {
              toast.error(msg(e));
            }
          }}
        />
      )}
    </section>
  );
}

function ChangelogDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: ChangelogEntry | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? "");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [tag, setTag] = useState<"New" | "Improved" | "">(entry?.tag ?? "");
  const [items, setItems] = useState((entry?.items ?? []).join("\n"));
  const [published, setPublished] = useState(entry?.published ?? false);
  const [sort, setSort] = useState(String(entry?.sort ?? 0));
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    const list = items
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!entryDate.trim() || !title.trim()) return toast.error("Date and title are required");
    if (list.length === 0) return toast.error("Add at least one bullet item");
    setBusy(true);
    try {
      await saveChangelog({
        id: entry?.id,
        entryDate: entryDate.trim(),
        title: title.trim(),
        tag: tag || null,
        items: list,
        published,
        sort: Number(sort) || 0,
      });
      toast.success(entry ? "Entry updated" : "Entry created");
      onDone();
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorShell title={entry ? "Edit entry" : "New What's-new entry"} onClose={onClose}>
        <label className="block text-xs text-muted-foreground">
          Display date (e.g. 2 September 2026)
          <Input value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Title
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Tag
          <select
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={tag}
            onChange={(e) => setTag(e.target.value as "New" | "Improved" | "")}
          >
            <option value="">None</option>
            <option value="New">New</option>
            <option value="Improved">Improved</option>
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">
          Bullet items (one per line; no em dashes, plain customer language)
          <textarea
            className="mt-1 min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm"
            value={items}
            onChange={(e) => setItems(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            Published
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort
            <Input className="w-20" type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={confirm} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
    </EditorShell>
  );
}

/* ---------------------------------- Blog ---------------------------------- */

function PostsTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<CmsPost[] | null>(null);
  const [editing, setEditing] = useState<CmsPost | "new" | null>(null);
  const [removing, setRemoving] = useState<CmsPost | null>(null);

  const reload = useCallback(() => {
    listPosts().then(setRows).catch((e) => {
      setRows([]);
      toast.error(msg(e));
    });
  }, []);
  useEffect(reload, [reload]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Posts appear on itrova's /blog once published. Bodies are markdown.
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> New post
          </Button>
        )}
      </div>
      {rows == null ? (
        <LoadingState />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Published</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No posts yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-muted-foreground">/{r.slug}</TableCell>
                  <TableCell>{r.tags.join(", ") || "·"}</TableCell>
                  <TableCell>
                    <PublishedPill on={r.publishedAt != null} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.publishedAt ? formatDate(r.publishedAt) : "·"}
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <PostDialog
          post={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title="Delete this post?"
          description={`"${removing.title}" will disappear from the blog immediately.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            try {
              await deletePost(removing.id);
              toast.success("Post deleted");
              setRemoving(null);
              reload();
            } catch (e) {
              toast.error(msg(e));
            }
          }}
        />
      )}
    </section>
  );
}

function PostDialog({
  post,
  onClose: dismiss,
  onDone,
}: {
  post: CmsPost | null;
  onClose: () => void;
  onDone: () => void;
}) {
  // Covers uploaded in this dialog session that never made it into a saved post are removed
  // again on cancel/replace, so the public bucket doesn't collect orphans.
  const sessionUploads = useRef<string[]>([]);
  const onClose = () => {
    for (const u of sessionUploads.current) if (u !== post?.coverUrl) void removeCmsMedia(u);
    sessionUploads.current = [];
    dismiss();
  };
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!post);
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [bodyMd, setBodyMd] = useState(post?.bodyMd ?? "");
  const [coverUrl, setCoverUrl] = useState(post?.coverUrl ?? "");
  const [tags, setTags] = useState((post?.tags ?? []).join(", "));
  const [author, setAuthor] = useState(post?.author ?? "The iTrova team");
  const [published, setPublished] = useState(post?.publishedAt != null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const onTitle = (v: string) => {
    setTitle(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadCmsMedia(file);
      sessionUploads.current.push(url);
      setCoverUrl(url);
      toast.success("Cover uploaded");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setUploading(false);
    }
  };

  const confirm = async () => {
    if (!title.trim() || !slug.trim()) return toast.error("Title and slug are required");
    if (!bodyMd.trim()) return toast.error("The post body is empty");
    if (/—/.test(`${title}${excerpt}${bodyMd}`)) return toast.error("Remove em dashes (—) from the copy");
    setBusy(true);
    try {
      await savePost({
        id: post?.id,
        slug: slug.trim(),
        title: title.trim(),
        excerpt: excerpt.trim(),
        bodyMd,
        coverUrl: coverUrl.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        author: author.trim(),
        publishedAt: published ? (post?.publishedAt ?? new Date().toISOString()) : null,
      });
      const finalCover = coverUrl.trim();
      for (const u of sessionUploads.current) if (u !== finalCover) void removeCmsMedia(u);
      if (post?.coverUrl && post.coverUrl !== finalCover) void removeCmsMedia(post.coverUrl);
      sessionUploads.current = [];
      toast.success(post ? "Post saved" : "Post created");
      onDone();
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorShell wide title={post ? "Edit post" : "New blog post"} onClose={onClose}>
        <label className="block text-xs text-muted-foreground">
          Title
          <Input value={title} onChange={(e) => onTitle(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Slug (itrova.co/blog/…)
          <Input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Excerpt (card + search snippet)
          <textarea
            className="mt-1 min-h-16 w-full rounded-md border border-input bg-background p-3 text-sm"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Body (markdown; ₦ examples, plain language, no em dashes)
          <textarea
            className="mt-1 min-h-56 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 text-xs text-muted-foreground">
            Cover image URL
            <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
          </label>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) upload(file);
              }}
            />
            <span className="inline-flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm">
              <Upload className="size-4" /> {uploading ? "Uploading…" : "Upload"}
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="block flex-1 text-xs text-muted-foreground">
            Tags (comma separated)
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Author
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={confirm} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
    </EditorShell>
  );
}

/* ------------------------------ Testimonials ------------------------------ */

function TestimonialsTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<CmsTestimonial[] | null>(null);
  const [editing, setEditing] = useState<CmsTestimonial | "new" | null>(null);
  const [removing, setRemoving] = useState<CmsTestimonial | null>(null);

  const reload = useCallback(() => {
    listTestimonials().then(setRows).catch((e) => {
      setRows([]);
      toast.error(msg(e));
    });
  }, []);
  useEffect(reload, [reload]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Real customer quotes only; the site's testimonial section stays hidden until at least one
          is published.
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> New testimonial
          </Button>
        )}
      </div>
      {rows == null ? (
        <LoadingState />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Quote</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No testimonials yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.business}</TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">{r.quote}</TableCell>
                  <TableCell>
                    <PublishedPill on={r.published} />
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <TestimonialDialog
          t={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title="Delete this testimonial?"
          description={`${removing.name}'s quote will disappear from the site immediately.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            try {
              await deleteTestimonial(removing.id);
              toast.success("Testimonial deleted");
              setRemoving(null);
              reload();
            } catch (e) {
              toast.error(msg(e));
            }
          }}
        />
      )}
    </section>
  );
}

function TestimonialDialog({
  t,
  onClose,
  onDone,
}: {
  t: CmsTestimonial | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(t?.name ?? "");
  const [business, setBusiness] = useState(t?.business ?? "");
  const [quote, setQuote] = useState(t?.quote ?? "");
  const [published, setPublished] = useState(t?.published ?? false);
  const [sort, setSort] = useState(String(t?.sort ?? 0));
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!name.trim() || !business.trim() || !quote.trim())
      return toast.error("Name, business and quote are required");
    setBusy(true);
    try {
      await saveTestimonial({
        id: t?.id,
        name: name.trim(),
        business: business.trim(),
        quote: quote.trim(),
        published,
        sort: Number(sort) || 0,
      });
      toast.success(t ? "Testimonial saved" : "Testimonial created");
      onDone();
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorShell title={t ? "Edit testimonial" : "New testimonial"} onClose={onClose}>
        <label className="block text-xs text-muted-foreground">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Business
          <Input value={business} onChange={(e) => setBusiness(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Quote (their words, verbatim)
          <textarea
            className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            Published
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort
            <Input className="w-20" type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={confirm} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
    </EditorShell>
  );
}

/* -------------------------------- Page copy ------------------------------- */

function CopyTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<CmsCopy[] | null>(null);
  const [editing, setEditing] = useState<CmsCopy | "new" | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const reload = useCallback(() => {
    listCopy().then(setRows).catch((e) => {
      setRows([]);
      toast.error(msg(e));
    });
  }, []);
  useEffect(reload, [reload]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Keyed JSON copy slots the site reads (e.g. pricing_faq, hero). Missing keys fall back to
          the copy built into the site.
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> New key
          </Button>
        )}
      </div>
      {rows == null ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          No copy overrides yet. The site uses its built-in copy.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-mono text-sm font-medium">{r.key}</TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                    {JSON.stringify(r.value)}
                  </TableCell>
                  <TableCell>
                    <PublishedPill on={r.published} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(r.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemovingKey(r.key)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <CopyDialog
          entry={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {removingKey && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemovingKey(null)}
          title="Delete this copy key?"
          description={`The site falls back to its built-in copy for "${removingKey}".`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            try {
              await deleteCopy(removingKey);
              toast.success("Key deleted");
              setRemovingKey(null);
              reload();
            } catch (e) {
              toast.error(msg(e));
            }
          }}
        />
      )}
    </section>
  );
}

function CopyDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: CmsCopy | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [key, setKey] = useState(entry?.key ?? "");
  const [value, setValue] = useState(JSON.stringify(entry?.value ?? {}, null, 2));
  const [published, setPublished] = useState(entry?.published ?? false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!key.trim()) return toast.error("Key is required");
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return toast.error("Value must be valid JSON");
    }
    setBusy(true);
    try {
      await saveCopy(key.trim(), parsed, published);
      toast.success("Copy saved");
      onDone();
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorShell title={entry ? `Edit "${entry.key}"` : "New copy key"} onClose={onClose}>
        <label className="block text-xs text-muted-foreground">
          Key
          <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={!!entry} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Value (JSON)
          <textarea
            className="mt-1 min-h-48 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published (visible to the site)
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={confirm} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
    </EditorShell>
  );
}
