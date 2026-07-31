import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Sparkles, Settings2, Share2, Pencil, MoreHorizontal, Download, Trash2, Check, SkipForward, Smartphone } from "lucide-react";
import {
  getMarketingAi, saveMarketingAi, listPosts, insertPosts, updatePost, setPostStatus, markShared, deletePost,
  generateDrafts, postingDates, PILLAR_LABEL, PROVIDER_LABEL, DEFAULT_MODELS,
  type MarketingAi, type SocialPost, type AiProvider, type Pillar,
} from "@/lib/marketing";
import { SHARE_TARGETS, shareUrl, canNativeShare, nativeShare, type ShareTarget } from "@/lib/shareIntents";
import { cardDataUrl, cardFile, downloadCard } from "@/lib/socialCard";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const STATUS_STYLE: Record<SocialPost["status"], string> = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-brand/15 text-brand",
  posted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  skipped: "bg-muted text-muted-foreground",
};

const monthLabel = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

export default function Marketing() {
  const { role, user } = useAuth();
  const isAdmin = role === "admin";
  // The program starts August 2026 — earlier months don't exist on this calendar.
  const FLOOR = { y: 2026, m: 7 };
  const beforeFloor = (y: number, m: number) => y < FLOOR.y || (y === FLOOR.y && m < FLOOR.m);
  // Open on the first month (≥ floor) that still has upcoming posting slots.
  const [ym, setYm] = useState<{ y: number; m: number }>(() => {
    const n = new Date();
    let y = n.getFullYear(), m = n.getMonth();
    if (postingDates(y, m, new Set()).length === 0) { if (m === 11) { y++; m = 0; } else m++; }
    return beforeFloor(y, m) ? { ...FLOOR } : { y, m };
  });
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [ai, setAi] = useState<MarketingAi | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const monthStart = iso(ym.y, ym.m, 1);
  const monthEnd = iso(ym.y, ym.m + 1, 0);

  const load = () => listPosts(monthStart, monthEnd).then(setPosts).catch((e) => toast.error(msg(e)));
  useEffect(() => { setPosts(null); load();   }, [monthStart]);
  useEffect(() => { getMarketingAi().then(setAi).catch((e) => toast.error(msg(e))); }, []);

  const generate = async () => {
    if (!ai) return;
    const taken = new Set((posts ?? []).map((p) => p.scheduledDate));
    setGenerating(true);
    try {
      const dates = postingDates(ym.y, ym.m, taken);
      const drafts = await generateDrafts(ai, dates);
      await insertPosts(drafts, user?.id);
      toast.success(`${drafts.length} draft${drafts.length === 1 ? "" : "s"} added — review and approve`);
      load();
    } catch (e) { toast.error(msg(e)); } finally { setGenerating(false); }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const p of posts ?? []) {
      if (!map.has(p.scheduledDate)) map.set(p.scheduledDate, []);
      map.get(p.scheduledDate)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [posts]);

  const counts = useMemo(() => {
    const c = { draft: 0, approved: 0, posted: 0 };
    for (const p of posts ?? []) if (p.status in c) c[p.status as keyof typeof c]++;
    return c;
  }, [posts]);

  return (
    <div>
      <PageHeader
        title="Marketing"
        subtitle="AI-drafted social calendar — review, approve, then share to your logged-in accounts."
        action={isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="size-4" /> AI settings</Button>
            <Button onClick={generate} disabled={generating || !ai}>
              <Sparkles className="size-4" /> {generating ? "Generating…" : "Generate month"}
            </Button>
          </div>
        )}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-border/60 p-1">
          <Button variant="ghost" size="sm" aria-label="Previous month"
            disabled={ym.y === FLOOR.y && ym.m === FLOOR.m}
            onClick={() => setYm(({ y, m }) => {
              const prev = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
              return beforeFloor(prev.y, prev.m) ? { y, m } : prev;
            })}><ChevronLeft className="size-4" /></Button>
          <span className="min-w-36 text-center text-sm font-semibold text-brand-dark">{monthLabel(ym.y, ym.m)}</span>
          <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}><ChevronRight className="size-4" /></Button>
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span className={cn("rounded-full px-2 py-1", STATUS_STYLE.draft)}>{counts.draft} draft</span>
          <span className={cn("rounded-full px-2 py-1", STATUS_STYLE.approved)}>{counts.approved} approved</span>
          <span className={cn("rounded-full px-2 py-1", STATUS_STYLE.posted)}>{counts.posted} posted</span>
        </div>
      </div>

      {posts == null ? <LoadingState /> : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          No posts for {monthLabel(ym.y, ym.m)} yet.{isAdmin && " Use Generate month to draft a calendar."}
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, list]) => (
            <div key={date} className="rounded-xl border border-border/60 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
              </div>
              {list.map((p) => (
                <PostRow key={p.id} p={p} ai={ai} isAdmin={isAdmin}
                  onEdit={() => setEditing(p)} onChanged={load} />
              ))}
            </div>
          ))}
        </div>
      )}

      {editing && ai && <EditDialog p={editing} ai={ai} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {settingsOpen && ai && <SettingsDialog value={ai} onClose={() => setSettingsOpen(false)} onSaved={(v) => { setAi(v); setSettingsOpen(false); }} />}
    </div>
  );
}

// --------------------------------------------------------------------------- post row + share
function fullCaption(p: SocialPost): string {
  return p.hashtags ? `${p.caption}\n\n${p.hashtags}` : p.caption;
}

function PostRow({ p, ai, isAdmin, onEdit, onChanged }: {
  p: SocialPost; ai: MarketingAi | null; isAdmin: boolean; onEdit: () => void; onChanged: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) { setShareOpen(false); setMoreOpen(false); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const copyCaption = async () => {
    try { await navigator.clipboard.writeText(fullCaption(p)); } catch { /* clipboard blocked — links still prefill */ }
  };

  const onShared = async (target: string) => {
    try { await markShared(p, target); onChanged(); } catch (e) { toast.error(msg(e)); }
  };

  const shareNative = async () => {
    try {
      const file = await cardFile(p.cardText || p.caption.slice(0, 60), footerUrl(ai));
      await nativeShare(fullCaption(p), canNativeShare(file) ? file : undefined);
      await onShared("mobile");
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") toast.error(msg(e));
    }
  };

  return (
    <div className="flex items-start justify-between gap-3 border-t border-border/40 py-2 first:border-t-0">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{PILLAR_LABEL[p.pillar]}</Badge>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", STATUS_STYLE[p.status])}>{p.status}</span>
          {p.postedTo.length > 0 && <span className="text-xs text-muted-foreground">shared: {p.postedTo.join(", ")}</span>}
        </div>
        <p className="whitespace-pre-wrap text-sm text-foreground">{p.caption}</p>
        {p.hashtags && <p className="mt-1 text-xs text-brand">{p.hashtags}</p>}
      </div>

      <div ref={wrapRef} className="relative flex shrink-0 items-center gap-1">
        {isAdmin && p.status === "draft" && (
          <Button size="sm" onClick={async () => { try { await setPostStatus(p.id, "approved"); onChanged(); } catch (e) { toast.error(msg(e)); } }}>
            <Check className="size-4" /> Approve
          </Button>
        )}
        {(p.status === "approved" || p.status === "posted") && (
          <Button variant="outline" size="sm" onClick={() => { setShareOpen(v => !v); setMoreOpen(false); }}>
            <Share2 className="size-4" /> Share
          </Button>
        )}
        {isAdmin && <Button variant="ghost" size="sm" aria-label="Edit post" onClick={onEdit}><Pencil className="size-4" /></Button>}
        {isAdmin && (
          <Button variant="ghost" size="sm" aria-label="More actions" onClick={() => { setMoreOpen(v => !v); setShareOpen(false); }}>
            <MoreHorizontal className="size-4" />
          </Button>
        )}

        {shareOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-border bg-card p-1 shadow-lg">
            <p className="px-2 py-1 text-[11px] text-muted-foreground">Caption is copied — opens your logged-in account.</p>
            {SHARE_TARGETS.map((t) => (
              <a key={t.key} href={shareUrl(t.key as ShareTarget, fullCaption(p), footerUrl(ai))}
                target="_blank" rel="noopener noreferrer"
                onClick={() => { copyCaption(); onShared(t.key); setShareOpen(false); }}
                className="block rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                {t.label}{t.prefills === "url" && <span className="text-xs text-muted-foreground"> · paste caption</span>}
              </a>
            ))}
            {canNativeShare() && (
              <button type="button" onClick={() => { shareNative(); setShareOpen(false); }}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
                <Smartphone className="size-3.5" /> Share with image… <span className="text-xs text-muted-foreground">(Instagram etc.)</span>
              </button>
            )}
          </div>
        )}

        {moreOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-border bg-card p-1 shadow-lg">
            <button type="button" onClick={() => { downloadCard(p.cardText || p.caption.slice(0, 60), footerUrl(ai)); setMoreOpen(false); }}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
              <Download className="size-3.5" /> Download card
            </button>
            {p.status !== "skipped" && (
              <button type="button" onClick={async () => { try { await setPostStatus(p.id, "skipped"); onChanged(); } catch (e) { toast.error(msg(e)); } setMoreOpen(false); }}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
                <SkipForward className="size-3.5" /> Skip
              </button>
            )}
            <button type="button" onClick={async () => { try { await deletePost(p.id); onChanged(); } catch (e) { toast.error(msg(e)); } setMoreOpen(false); }}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted">
              <Trash2 className="size-3.5" /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const footerUrl = (ai: MarketingAi | null) => ai?.productUrl || "https://allspire.tech/products";

// --------------------------------------------------------------------------- edit dialog
function EditDialog({ p, ai, onClose, onSaved }: { p: SocialPost; ai: MarketingAi; onClose: () => void; onSaved: () => void }) {
  const [caption, setCaption] = useState(p.caption);
  const [hashtags, setHashtags] = useState(p.hashtags ?? "");
  const [cardText, setCardText] = useState(p.cardText ?? "");
  const [date, setDate] = useState(p.scheduledDate);
  const [pillar, setPillar] = useState<Pillar>(p.pillar);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => cardDataUrl(cardText || caption.slice(0, 60), footerUrl(ai)), [cardText, caption, ai]);

  const save = async () => {
    if (!caption.trim()) return toast.error("Caption can't be empty");
    setBusy(true);
    try {
      await updatePost(p.id, { caption: caption.trim(), hashtags, cardText, scheduledDate: date, pillar });
      toast.success("Post updated"); onSaved();
    } catch (e) { toast.error(msg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-semibold text-brand-dark">Edit post</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground">Date<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="block text-xs text-muted-foreground">Pillar
            <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={pillar} onChange={(e) => setPillar(e.target.value as Pillar)}>
              {Object.entries(PILLAR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs text-muted-foreground">Caption
          <textarea className="mt-1 min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">Hashtags<Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#SME #Nigeria" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground">Card hook (image text)
            <Input value={cardText} onChange={(e) => setCardText(e.target.value)} maxLength={80} />
            <span className="mt-1 block">Rendered on the branded card below.</span>
          </label>
          <img src={preview} alt="Branded card preview" className="w-full max-w-48 justify-self-end rounded-lg border border-border/60" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- AI settings dialog
function SettingsDialog({ value, onClose, onSaved }: { value: MarketingAi; onClose: () => void; onSaved: (v: MarketingAi) => void }) {
  const [v, setV] = useState<MarketingAi>(value);
  const [busy, setBusy] = useState(false);

  const setProvider = (provider: AiProvider) => setV((x) => ({ ...x, provider, model: DEFAULT_MODELS[provider] }));
  const setKey = (provider: AiProvider, key: string) => setV((x) => ({ ...x, keys: { ...x.keys, [provider]: key } }));

  const save = async () => {
    setBusy(true);
    try { await saveMarketingAi(v); toast.success("AI settings saved"); onSaved(v); }
    catch (e) { toast.error(msg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-semibold text-brand-dark">AI settings</h3>
        <p className="text-sm text-muted-foreground">Free-tier cloud models draft the calendar. Keys are free to create (no card) and are stored for the whole team.</p>
        <label className="block text-xs text-muted-foreground">Provider
          <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={v.provider} onChange={(e) => setProvider(e.target.value as AiProvider)}>
            {Object.entries(PROVIDER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">Model<Input value={v.model} onChange={(e) => setV((x) => ({ ...x, model: e.target.value }))} /></label>
        <label className="block text-xs text-muted-foreground">Gemini API key <span className="text-muted-foreground/70">(aistudio.google.com)</span>
          <Input type="password" value={v.keys.gemini ?? ""} onChange={(e) => setKey("gemini", e.target.value)} /></label>
        <label className="block text-xs text-muted-foreground">Groq API key <span className="text-muted-foreground/70">(console.groq.com)</span>
          <Input type="password" value={v.keys.groq ?? ""} onChange={(e) => setKey("groq", e.target.value)} /></label>
        <label className="block text-xs text-muted-foreground">OpenRouter API key <span className="text-muted-foreground/70">(openrouter.ai)</span>
          <Input type="password" value={v.keys.openrouter ?? ""} onChange={(e) => setKey("openrouter", e.target.value)} /></label>
        <label className="block text-xs text-muted-foreground">Link used in posts<Input value={v.productUrl} onChange={(e) => setV((x) => ({ ...x, productUrl: e.target.value }))} /></label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
