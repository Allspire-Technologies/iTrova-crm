import { listBusinessAggregates } from "@/lib/admin";
import { listCurrentHealth } from "@/lib/health";
import { listActiveAlertsForHome } from "@/lib/alerts";
import type { HealthBand, AlertSeverity } from "@/lib/cs";

// Dashboard Home data (PRD §7.1 + metric definitions §8). Everything is derived from three
// secured sources in parallel (no N+1): the aggregates RPC, the health view, the alerts view.

const DAY = 86_400_000;
const RENEWAL_WINDOW_DAYS = 14;
const ACTIVE_LOGIN_DAYS = 30;

export type HomeKpis = {
  totalBusinesses: number;
  activeBusinesses: number; // ≥1 login in last 30d
  trialBusinesses: number;
  payingBusinesses: number;
  mrr: number;
  arr: number;
  atRisk: number; // red band OR active churn/renewal alert
  dueRenewal: number; // renewal within 14d
  newThisMonth: number;
  currency: string;
};

export type AtRiskItem = {
  businessId: string;
  name: string;
  reason: string;
  severity: AlertSeverity;
  band: HealthBand | null;
};

export type RenewalItem = {
  businessId: string;
  name: string;
  planKey: string | null;
  renewalDate: string;
  daysLeft: number;
};

export type HomeData = { kpis: HomeKpis; atRisk: AtRiskItem[]; renewals: RenewalItem[] };

const daysUntil = (iso: string | null, now: number) => (iso ? Math.ceil((new Date(iso).getTime() - now) / DAY) : null);
const daysSince = (iso: string | null, now: number) => (iso ? (now - new Date(iso).getTime()) / DAY : null);

// Months per billing cycle — mirrors public.cs_cycle_months. iTrova bills monthly / quarterly /
// biannual / annual (legacy 'month'/'year' accepted); unknown → 1 so we never inflate MRR.
const CYCLE_MONTHS: Record<string, number> = {
  monthly: 1, month: 1,
  quarterly: 3, quarter: 3,
  biannual: 6, semiannual: 6,
  annual: 12, annually: 12, yearly: 12, year: 12,
};
const cycleMonths = (cycle: string | null) => CYCLE_MONTHS[(cycle ?? "monthly").toLowerCase()] ?? 1;

export async function getHomeData(): Promise<HomeData> {
  const [aggs, health, alerts] = await Promise.all([
    listBusinessAggregates(),
    listCurrentHealth(),
    listActiveAlertsForHome(),
  ]);

  const now = Date.now();
  const d = new Date();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

  const bandByBiz = new Map<string, HealthBand>(health.map((h) => [h.business_id, h.band]));

  let activeBusinesses = 0;
  let trialBusinesses = 0;
  let payingBusinesses = 0;
  let newThisMonth = 0;
  let mrr = 0;

  for (const a of aggs) {
    const sinceLogin = daysSince(a.lastLogin, now);
    if (sinceLogin != null && sinceLogin <= ACTIVE_LOGIN_DAYS) activeBusinesses++;

    const renewalDays = daysUntil(a.renewalDate, now);
    // Trial = trialing status OR the free plan; Paying = active on a NON-free plan (free is
    // never "paying" — the sync trigger marks every business active, incl. free).
    const isFree = (a.planKey ?? "free") === "free";
    if ((a.subscriptionStatus === "trialing" && (renewalDays == null || renewalDays > 0)) || isFree) trialBusinesses++;
    if (a.subscriptionStatus === "active" && !isFree) payingBusinesses++;

    if (new Date(a.joinedAt).getTime() >= monthStart) newThisMonth++;
    if (a.subscriptionStatus === "active" && a.subscriptionAmount) {
      mrr += a.subscriptionAmount / cycleMonths(a.subscriptionCycle);
    }
  }
  mrr = Math.round(mrr);

  // At risk = red band OR an active churn/renewal alert (§8).
  const atRiskIds = new Set<string>();
  for (const a of aggs) if (bandByBiz.get(a.businessId) === "red") atRiskIds.add(a.businessId);
  for (const al of alerts) if (al.kind === "churn" || al.kind === "renewal") atRiskIds.add(al.business_id);

  // Renewals due within 14 days (paying or trialing).
  const renewals: RenewalItem[] = aggs
    .map((a) => ({ a, days: daysUntil(a.renewalDate, now) }))
    .filter(
      ({ a, days }) =>
        a.renewalDate != null &&
        days != null &&
        days >= 0 &&
        days <= RENEWAL_WINDOW_DAYS &&
        (a.subscriptionStatus === "active" || a.subscriptionStatus === "trialing"),
    )
    .sort((x, y) => (x.days as number) - (y.days as number))
    .map(({ a, days }) => ({
      businessId: a.businessId,
      name: a.name,
      planKey: a.planKey,
      renewalDate: a.renewalDate as string,
      daysLeft: days as number,
    }));

  // At-risk list: churn/renewal alerts (with severity) + any red-band business, criticals first.
  const nameByBiz = new Map<string, string>(aggs.map((a) => [a.businessId, a.name]));
  const atRiskMap = new Map<string, AtRiskItem>();
  for (const al of alerts) {
    if (al.kind !== "churn" && al.kind !== "renewal") continue;
    atRiskMap.set(al.business_id, {
      businessId: al.business_id,
      name: al.business_name ?? nameByBiz.get(al.business_id) ?? "Unknown business",
      reason: al.detail ?? `${al.kind} risk`,
      severity: al.severity,
      band: bandByBiz.get(al.business_id) ?? null,
    });
  }
  for (const a of aggs) {
    if (bandByBiz.get(a.businessId) === "red" && !atRiskMap.has(a.businessId)) {
      atRiskMap.set(a.businessId, { businessId: a.businessId, name: a.name, reason: "Health band: Red", severity: "critical", band: "red" });
    }
  }
  const atRisk = [...atRiskMap.values()]
    .sort((x, y) => (x.severity === "critical" ? 0 : 1) - (y.severity === "critical" ? 0 : 1))
    .slice(0, 8);

  return {
    kpis: {
      totalBusinesses: aggs.length,
      activeBusinesses,
      trialBusinesses,
      payingBusinesses,
      mrr,
      arr: mrr * 12,
      atRisk: atRiskIds.size,
      dueRenewal: renewals.length,
      newThisMonth,
      currency: aggs[0]?.currency ?? "NGN",
    },
    atRisk,
    renewals,
  };
}
