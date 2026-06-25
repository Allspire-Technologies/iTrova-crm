import { getDashboardKpis, listBusinessAggregates } from "@/lib/admin";

// KPIs come from the staff-gated admin_dashboard_kpis RPC (DB-side aggregation over the
// materialized view); plan distribution and recent signups are derived from the per-business
// aggregate list. No raw operational rows are pulled to the browser.

export type PlanMixEntry = { planKey: string; count: number };

export type RecentBusiness = {
  id: string;
  name: string;
  planKey: string | null;
  createdAt: string;
};

export type DashboardStats = {
  totalBusinesses: number;
  activeSubscriptions: number;
  newThisMonth: number;
  mrr: number;
  currency: string;
  totalRevenue: number;
  totalSales: number;
  totalProducts: number;
  planMix: PlanMixEntry[];
  recent: RecentBusiness[];
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const [kpis, aggs] = await Promise.all([getDashboardKpis(), listBusinessAggregates()]);

  const mixMap = new Map<string, number>();
  for (const a of aggs) {
    const key = a.planKey ?? "none";
    mixMap.set(key, (mixMap.get(key) ?? 0) + 1);
  }
  const planMix = [...mixMap.entries()]
    .map(([planKey, count]) => ({ planKey, count }))
    .sort((a, b) => b.count - a.count);

  // aggs are ordered newest-first by the RPC.
  const recent: RecentBusiness[] = aggs.slice(0, 6).map((a) => ({
    id: a.businessId,
    name: a.name,
    planKey: a.planKey,
    createdAt: a.joinedAt,
  }));

  return {
    totalBusinesses: kpis.totalBusinesses,
    activeSubscriptions: kpis.activeSubscriptions,
    newThisMonth: kpis.newThisMonth,
    mrr: kpis.mrr,
    currency: kpis.currency,
    totalRevenue: kpis.totalRevenue,
    totalSales: kpis.totalSales,
    totalProducts: kpis.totalProducts,
    planMix,
    recent,
  };
}
