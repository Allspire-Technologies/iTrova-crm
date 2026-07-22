import { supabase } from "@/integrations/supabase/client";
import type { ReferrerKind, ReferralConfig } from "./referralMath";

// Referrals module data access. Conventions mirror src/lib/messaging.ts.
// referral_config + businesses.referral columns live on the shared project (added by the iTrova
// migration); the tables/RPCs here come from supabase/migrations/20260731100000_referrals.sql.
// The generated Supabase types don't yet know these, so we cast the client once.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type Referrer = {
  code: string;
  name: string;
  kind: ReferrerKind;
  phone: string;
  email: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  sharePercent: number | null; // null = use the config default
  active: boolean;
  notes: string | null;
};

export type ReferrerApplication = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  howPromote: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type ReferredBusiness = {
  businessId: string;
  businessName: string;
  signedUpAt: string;
  code: string;
  referrerName: string | null;
  referrerKind: ReferrerKind | null;
  effectiveSharePercent: number | null;
  planKey: string | null;
  firstPaidAt: string | null;
  totalPaid12m: number;
  converted: boolean;
  matched: boolean;
};

export type ReferrerSummary = {
  code: string; name: string; kind: ReferrerKind; phone: string | null; email: string | null;
  active: boolean; businessId: string | null; sharePercent: number;
  referredCount: number; convertedCount: number; earned: number; paid: number; accrued: number;
  bankName: string | null; accountNumber: string | null; accountName: string | null;
};

export async function getReferralConfig(): Promise<ReferralConfig> {
  const { data, error } = await sb.from("referral_config").select("*").maybeSingle();
  if (error) throw error;
  return (data ?? { affiliate_share_percent: 25, business_share_percent: 25, referee_discount_percent: 20, staff_bonus: {} }) as ReferralConfig;
}

/** All referrers (affiliates/staff + businesses that generated a code) with earned/paid/accrued. */
export async function listReferrerSummary(search?: string): Promise<ReferrerSummary[]> {
  const { data, error } = await sb.rpc("cs_referrers_summary", { p_search: search?.trim() || null });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    code: String(r.code), name: String(r.name), kind: String(r.kind) as ReferrerKind,
    phone: r.phone == null ? null : String(r.phone), email: r.email == null ? null : String(r.email),
    active: Boolean(r.active), businessId: r.business_id == null ? null : String(r.business_id),
    sharePercent: Number(r.effective_share_percent) || 0,
    referredCount: Number(r.referred_count) || 0, convertedCount: Number(r.converted_count) || 0,
    earned: Number(r.earned) || 0, paid: Number(r.paid) || 0, accrued: Number(r.accrued) || 0,
    bankName: r.bank_name == null ? null : String(r.bank_name),
    accountNumber: r.account_number == null ? null : String(r.account_number),
    accountName: r.account_name == null ? null : String(r.account_name),
  }));
}

/** Record a payout: cash (affiliate/staff, pass code) or subscription credit (business, pass
 *  businessId — auto-extends their renewal). Returns whole months added (subscription only). */
export async function recordPayout(input: { code?: string | null; businessId?: string | null; amount: number; kind: "cash" | "subscription"; note?: string }): Promise<number> {
  const { data, error } = await sb.rpc("cs_record_payout", {
    p_code: input.code ?? null, p_business_id: input.businessId ?? null,
    p_amount: input.amount, p_kind: input.kind, p_note: input.note ?? null,
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function updateReferralConfig(patch: Partial<ReferralConfig>): Promise<void> {
  const { error } = await sb.from("referral_config").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) throw error;
}

export async function listReferrers(): Promise<Referrer[]> {
  const { data, error } = await sb.from("cs_referrer").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapReferrer);
}

export async function saveReferrer(r: Referrer, isNew: boolean): Promise<void> {
  const row = {
    code: r.code.trim().toUpperCase(), name: r.name.trim(), kind: r.kind, phone: r.phone.trim(),
    email: r.email || null,
    bank_name: r.bankName || null, account_number: r.accountNumber || null, account_name: r.accountName || null,
    share_percent: r.sharePercent == null || Number.isNaN(r.sharePercent) ? null : r.sharePercent,
    active: r.active, notes: r.notes || null,
  };
  const { error } = isNew
    ? await sb.from("cs_referrer").insert(row)
    : await sb.from("cs_referrer").update(row).eq("code", row.code);
  if (error) throw error;
}

/** Email a referrer their code, share link and program terms (via the send-referrer-welcome
 *  Edge Function, which holds the Sender.net token and reads the config server-side). */
export async function sendReferrerWelcome(code: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("send-referrer-welcome", { body: { code } });
  if (error) {
    if ((error as { name?: string }).name === "FunctionsFetchError") throw new Error("Couldn't reach the email function — deploy it: supabase functions deploy send-referrer-welcome");
    let message = error.message;
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) message = b.error; } catch { /* keep */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
}

export async function setReferrerActive(code: string, active: boolean): Promise<void> {
  const { error } = await sb.from("cs_referrer").update({ active }).eq("code", code);
  if (error) throw error;
}

export async function listApplications(): Promise<ReferrerApplication[]> {
  const { data, error } = await sb.from("cs_referrer_application").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((a) => ({
    id: String(a.id), name: String(a.name), phone: String(a.phone),
    email: a.email == null ? null : String(a.email),
    howPromote: a.how_promote == null ? null : String(a.how_promote),
    status: String(a.status) as ReferrerApplication["status"], createdAt: String(a.created_at),
  }));
}

export async function setApplicationStatus(id: string, status: "approved" | "rejected", notes?: string): Promise<void> {
  const { error } = await sb.from("cs_referrer_application").update({ status, notes: notes ?? null }).eq("id", id);
  if (error) throw error;
}

export async function listReferredBusinesses(search?: string): Promise<ReferredBusiness[]> {
  const { data, error } = await sb.rpc("cs_referrals", { p_search: search?.trim() || null });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    businessId: String(r.business_id), businessName: String(r.business_name), signedUpAt: String(r.signed_up_at),
    code: String(r.code),
    referrerName: r.referrer_name == null ? null : String(r.referrer_name),
    referrerKind: r.referrer_kind == null ? null : (String(r.referrer_kind) as ReferrerKind),
    effectiveSharePercent: r.effective_share_percent == null ? null : Number(r.effective_share_percent),
    planKey: r.plan_key == null ? null : String(r.plan_key),
    firstPaidAt: r.first_paid_at == null ? null : String(r.first_paid_at),
    totalPaid12m: Number(r.total_paid_12m) || 0,
    converted: Boolean(r.converted), matched: Boolean(r.matched),
  }));
}

function mapReferrer(r: Record<string, unknown>): Referrer {
  return {
    code: String(r.code), name: String(r.name), kind: String(r.kind) as ReferrerKind, phone: String(r.phone),
    email: r.email == null ? null : String(r.email),
    bankName: r.bank_name == null ? null : String(r.bank_name),
    accountNumber: r.account_number == null ? null : String(r.account_number),
    accountName: r.account_name == null ? null : String(r.account_name),
    sharePercent: r.share_percent == null ? null : Number(r.share_percent),
    active: Boolean(r.active), notes: r.notes == null ? null : String(r.notes),
  };
}
