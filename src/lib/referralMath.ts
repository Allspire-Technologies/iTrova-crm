// Pure referral-reward math + code suggestion. Mirrors docs/knowledge/iTrova-referral-program.md
// in the iTrova repo. Kept dependency-free and unit-tested so the numbers live in one place.

export type ReferrerKind = "affiliate" | "staff" | "business";

export type ReferralConfig = {
  affiliate_share_percent: number;
  referee_discount_percent: number;
  business_free_months: number;              // free months granted each time the threshold is met
  business_referrals_per_free_month: number; // converted referrals needed to earn those free months
  staff_bonus: Record<string, number>;       // by plan key, e.g. { pro: 2000, business: 5000, enterprise: 10000 }
};

/** Free months a BUSINESS referrer has earned so far, given how many of their referrals have
 *  converted (aggregate, not per-referral): floor(converted / N) × business_free_months. */
export function businessFreeMonths(convertedCount: number, config: ReferralConfig): number {
  const per = Math.max(1, Math.round(config.business_referrals_per_free_month ?? 1));
  return Math.floor(convertedCount / per) * Math.max(0, Math.round(config.business_free_months ?? 0));
}

export type ReferralRow = {
  kind: ReferrerKind | null;
  effectiveSharePercent: number | null; // for affiliates (config default already applied server-side)
  planKey: string | null;
  totalPaid12m: number;
  converted: boolean;
};

/** What a single referral is worth to its referrer, given the program config.
 *  - affiliate: `share% × payments in the first 12 months`
 *  - staff:     a flat per-conversion sales bonus (SPIFF) by the referred plan, once converted
 *  - business:  free months (count them elsewhere); no cash value here
 *  Returns 0 until the referral has converted (made a first payment). */
export function rewardFor(row: ReferralRow, config: ReferralConfig): { cash: number; freeMonths: number } {
  if (!row.converted) return { cash: 0, freeMonths: 0 };
  switch (row.kind) {
    case "affiliate": {
      const pct = row.effectiveSharePercent ?? config.affiliate_share_percent ?? 0;
      return { cash: Math.round((row.totalPaid12m * pct) / 100), freeMonths: 0 };
    }
    case "staff": {
      const key = (row.planKey ?? "").toLowerCase();
      return { cash: Number(config.staff_bonus?.[key] ?? 0), freeMonths: 0 };
    }
    case "business":
      // Business free months are earned in aggregate (N referrals → a free month), not per row —
      // see businessFreeMonths(). A single converted referral just counts toward the threshold.
      return { cash: 0, freeMonths: 0 };
    default:
      return { cash: 0, freeMonths: 0 };
  }
}

/** A referral code: NAME slug (A–Z0–9, capped) + the last 4 digits of the phone. */
export function suggestCode(name: string, phone: string, slugLen = 10): string {
  const slug = (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, slugLen) || "ITROVA";
  const last4 = (phone || "").replace(/[^0-9]/g, "").slice(-4);
  return slug + last4;
}
