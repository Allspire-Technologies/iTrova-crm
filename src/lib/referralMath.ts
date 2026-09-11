// Pure referral-reward math + code suggestion. Mirrors docs/knowledge/iTrova-referral-program.md
// in the iTrova repo. Kept dependency-free and unit-tested so the numbers live in one place.

export type ReferrerKind = "affiliate" | "staff" | "business";

export type ReferralConfig = {
  affiliate_share_percent: number; // affiliates' cash share of first-year revenue
  business_share_percent: number;  // referring businesses' subscription-credit share
  referee_discount_percent: number;
  staff_bonus: Record<string, number>; // by plan key, e.g. { pro: 2000, business: 5000, enterprise: 10000 }
  /** Months of a referred business's paid life that earn the referrer. Drives the earnings maths. */
  reward_window_months: number;
  /** Payouts go out within this many days of month end (terms page copy). */
  payout_within_days: number;
  /** A referral that stops paying within this many months has its reward reversed (terms page copy). */
  clawback_months: number;
};

export type ReferralRow = {
  kind: ReferrerKind | null;
  effectiveSharePercent: number | null; // config default for the kind already applied server-side
  planKey: string | null;
  /** First-year SUBSCRIPTION value (plan price × months on the plan, capped at 12), not the
   *  hand-logged payment total — see the cs_referral_revenue view. Named for its DB column. */
  totalPaid12m: number;
  converted: boolean;
};

/** What a single referral is worth to its referrer, given the program config.
 *  - affiliate: `affiliate_share% × first-year subscription value` (paid as cash)
 *  - business: `business_share% × first-year subscription value` (accrues as subscription credit,
 *    applied by an admin) — a separate rate from the affiliate share
 *  - staff: a flat per-conversion sales bonus (SPIFF) by the referred plan
 *  Returns 0 until the referral has converted (is on a paid plan). Mirrors _referral_reward(). */
export function rewardFor(row: ReferralRow, config: ReferralConfig): { cash: number } {
  if (!row.converted) return { cash: 0 };
  if (row.kind === "staff") {
    return { cash: Number(config.staff_bonus?.[(row.planKey ?? "").toLowerCase()] ?? 0) };
  }
  // A per-referrer override wins; otherwise the rate depends on the referrer kind.
  const base = row.kind === "business" ? config.business_share_percent : config.affiliate_share_percent;
  const pct = row.effectiveSharePercent ?? base ?? 0;
  return { cash: Math.round((row.totalPaid12m * pct) / 100) };
}

/** A referral code: NAME slug (A–Z0–9, capped) + the last 4 digits of the phone. */
export function suggestCode(name: string, phone: string, slugLen = 10): string {
  const slug = (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, slugLen) || "ITROVA";
  const last4 = (phone || "").replace(/[^0-9]/g, "").slice(-4);
  return slug + last4;
}
