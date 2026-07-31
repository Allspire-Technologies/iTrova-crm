import { supabase } from "@/integrations/supabase/client";

// Social content calendar: free-tier cloud models draft posts (called straight from the browser
// with keys stored in cs_settings.marketing_ai), staff review/approve, then share via web intents
// (src/lib/shareIntents.ts). No platform APIs, no auto-posting. Tables/columns postdate the
// generated Supabase types, so cast the client once.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type AiProvider = "gemini" | "groq" | "openrouter";
export type PostStatus = "draft" | "approved" | "posted" | "skipped";
export type Pillar = "tip" | "feature" | "referral" | "offer" | "story";

export const PILLAR_LABEL: Record<Pillar, string> = {
  tip: "SMB tip", feature: "Feature", referral: "Referral", offer: "Offer", story: "Story",
};

export type SocialPost = {
  id: string;
  scheduledDate: string; // YYYY-MM-DD
  pillar: Pillar;
  caption: string;
  hashtags: string | null;
  cardText: string | null;
  status: PostStatus;
  postedTo: string[];
  notes: string | null;
};

export type MarketingAi = {
  provider: AiProvider;
  model: string;
  keys: Partial<Record<AiProvider, string>>;
  productUrl: string;
};

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
};

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  gemini: "Google Gemini (free tier)", groq: "Groq · Llama (free tier)", openrouter: "OpenRouter (free models)",
};

const DEFAULT_AI: MarketingAi = { provider: "gemini", model: DEFAULT_MODELS.gemini, keys: {}, productUrl: "https://allspire.tech/products" };

export async function getMarketingAi(): Promise<MarketingAi> {
  const { data, error } = await sb.from("cs_settings").select("marketing_ai").maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_AI, ...((data?.marketing_ai ?? {}) as Partial<MarketingAi>) };
}

export async function saveMarketingAi(ai: MarketingAi): Promise<void> {
  const { error } = await sb.from("cs_settings").update({ marketing_ai: ai }).eq("singleton", true);
  if (error) throw error;
}

// ------------------------------------------------------------------ posts CRUD
export async function listPosts(monthStart: string, monthEnd: string): Promise<SocialPost[]> {
  const { data, error } = await sb.from("cs_social_post").select("*")
    .gte("scheduled_date", monthStart).lte("scheduled_date", monthEnd)
    .order("scheduled_date");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapPost);
}

export async function insertPosts(posts: Omit<SocialPost, "id" | "status" | "postedTo" | "notes">[], createdBy?: string): Promise<void> {
  const rows = posts.map(p => ({
    scheduled_date: p.scheduledDate, pillar: p.pillar, caption: p.caption,
    hashtags: p.hashtags || null, card_text: p.cardText || null, created_by: createdBy ?? null,
  }));
  const { error } = await sb.from("cs_social_post").insert(rows);
  if (error) throw error;
}

export async function updatePost(id: string, patch: Partial<Pick<SocialPost, "caption" | "hashtags" | "cardText" | "scheduledDate" | "pillar" | "notes">>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.caption !== undefined) row.caption = patch.caption;
  if (patch.hashtags !== undefined) row.hashtags = patch.hashtags || null;
  if (patch.cardText !== undefined) row.card_text = patch.cardText || null;
  if (patch.scheduledDate !== undefined) row.scheduled_date = patch.scheduledDate;
  if (patch.pillar !== undefined) row.pillar = patch.pillar;
  if (patch.notes !== undefined) row.notes = patch.notes || null;
  const { error } = await sb.from("cs_social_post").update(row).eq("id", id);
  if (error) throw error;
}

export async function setPostStatus(id: string, status: PostStatus): Promise<void> {
  const { error } = await sb.from("cs_social_post").update({ status }).eq("id", id);
  if (error) throw error;
}

/** Record a share to a platform (and flip approved → posted). */
export async function markShared(post: SocialPost, platform: string): Promise<void> {
  const posted_to = Array.from(new Set([...post.postedTo, platform]));
  const { error } = await sb.from("cs_social_post").update({ posted_to, status: "posted" }).eq("id", post.id);
  if (error) throw error;
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await sb.from("cs_social_post").delete().eq("id", id);
  if (error) throw error;
}

function mapPost(r: Record<string, unknown>): SocialPost {
  return {
    id: String(r.id), scheduledDate: String(r.scheduled_date), pillar: (String(r.pillar) as Pillar) || "tip",
    caption: String(r.caption), hashtags: r.hashtags == null ? null : String(r.hashtags),
    cardText: r.card_text == null ? null : String(r.card_text),
    status: String(r.status) as PostStatus, postedTo: (r.posted_to as string[]) ?? [],
    notes: r.notes == null ? null : String(r.notes),
  };
}

// ------------------------------------------------------------------ generation (free cloud models)
export type DraftPost = { scheduledDate: string; pillar: Pillar; caption: string; hashtags: string; cardText: string };

/** Mon/Wed/Fri + every other Saturday ≈ the 3–4 posts/week cadence. Only FUTURE dates count —
 *  elapsed days of the month are never scheduled — and already-used dates are skipped. */
export function postingDates(year: number, month: number, taken: Set<string>, today: string = new Date().toISOString().slice(0, 10)): string[] {
  const dates: string[] = [];
  let satToggle = true;
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    const dow = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    const isSat = dow === 6;
    if ((dow === 1 || dow === 3 || dow === 5 || (isSat && satToggle)) && !taken.has(iso) && iso > today) dates.push(iso);
    if (isSat) satToggle = !satToggle;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

const PRODUCT_FACTS = `iTrova (by Allspire) is a business management app for Nigerian & African SMBs:
inventory & stock control with low-stock alerts, point of sale (cash/transfer/POS, split payments),
invoices that deduct stock, suppliers & raw materials with bill-of-materials, production tracking,
team roles & permissions, reports (revenue, profit, top products), accounting ledger, and offline
support (works without internet, syncs later). Referral program: businesses earn subscription credit
for referring others; affiliates earn a cash share. Free plan available; paid plans in Naira.`;

function buildPrompt(dates: string[], productUrl: string): string {
  return `You are the social media manager for iTrova. ${PRODUCT_FACTS}

Write one social post for EACH of these dates: ${dates.join(", ")}.
Rotate pillars across posts: "tip" (practical SMB advice — inventory, cash flow, pricing, customer retention; sell nothing, teach), "feature" (one iTrova capability, concrete benefit), "referral" (earn by referring), "offer" (try iTrova free), "story" (relatable Nigerian SMB scenario). Mostly tips and features.
Tone: warm, direct, Nigerian-market savvy. No emojis overload (max 2), no hype words like "revolutionary".
Each caption ≤ 500 characters, ends with ${productUrl}. Hashtags: 3-5, Nigerian SMB relevant.
card_text: a punchy ≤ 60-character hook version of the post for an image card.

Return ONLY a JSON array, no markdown fences, each item:
{"date": "YYYY-MM-DD", "pillar": "tip|feature|referral|offer|story", "caption": "...", "hashtags": "#a #b #c", "card_text": "..."}`;
}

/** Calls the selected free-tier provider straight from the browser. */
export async function generateDrafts(ai: MarketingAi, dates: string[]): Promise<DraftPost[]> {
  const key = ai.keys[ai.provider];
  if (!key) throw new Error(`No API key saved for ${PROVIDER_LABEL[ai.provider]} — add it in Settings`);
  if (dates.length === 0) throw new Error("Every posting date this month already has a post");
  const prompt = buildPrompt(dates, ai.productUrl);
  const text = ai.provider === "gemini" ? await callGemini(ai.model, key, prompt) : await callOpenAiCompatible(ai.provider, ai.model, key, prompt);
  return parseDrafts(text, dates);
}

async function callGemini(model: string, key: string, prompt: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.8 } }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini returned no content");
  return text;
}

async function callOpenAiCompatible(provider: AiProvider, model: string, key: string, prompt: string): Promise<string> {
  const base = provider === "groq" ? "https://api.groq.com/openai/v1" : "https://openrouter.ai/api/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0.8, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`${PROVIDER_LABEL[provider]} error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error(`${PROVIDER_LABEL[provider]} returned no content`);
  return text;
}

/** Tolerant parse: strips code fences, validates dates against the requested set. */
export function parseDrafts(text: string, dates: string[]): DraftPost[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("["); const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("The model didn't return a JSON list — try again");
  let arr: unknown;
  try { arr = JSON.parse(cleaned.slice(start, end + 1)); } catch { throw new Error("Couldn't parse the model's response — try again"); }
  if (!Array.isArray(arr)) throw new Error("The model didn't return a list — try again");
  const allowed = new Set(dates);
  const pillars = new Set(["tip", "feature", "referral", "offer", "story"]);
  const out: DraftPost[] = [];
  const usedDates = new Set<string>();
  for (const item of arr as Record<string, unknown>[]) {
    const caption = String(item.caption ?? "").trim();
    if (!caption) continue;
    let date = String(item.date ?? "").slice(0, 10);
    if (!allowed.has(date) || usedDates.has(date)) date = dates.find(d => !usedDates.has(d)) ?? "";
    if (!date) continue;
    usedDates.add(date);
    out.push({
      scheduledDate: date,
      pillar: (pillars.has(String(item.pillar)) ? String(item.pillar) : "tip") as Pillar,
      caption,
      hashtags: String(item.hashtags ?? "").trim(),
      cardText: String(item.card_text ?? "").trim().slice(0, 80) || caption.slice(0, 60),
    });
  }
  if (out.length === 0) throw new Error("The model returned no usable posts — try again");
  return out.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
}
