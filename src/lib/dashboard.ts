import { supabase } from "@/integrations/supabase/client";
import type { SubscriptionStatus } from "@/lib/customers";

// All cross-tenant reads — only return data for a platform-admin session (admin-read RLS).

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
  mrr: number; // monthly-normalised recurring revenue
  currency: string;
  planMix: PlanMixEntry[];
  recent: RecentBusiness[];
};

function startOfMonth(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [bizRes, subRes] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, subscription_tier, currency, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("subscriptions").select("status, cycle, amount, currency"),
  ]);
  if (bizRes.error) throw bizRes.error;
  if (subRes.error) throw subRes.error;

  const businesses = bizRes.data ?? [];
  const subs = subRes.data ?? [];

  const monthStart = startOfMonth();
  const newThisMonth = businesses.filter((b) => new Date(b.created_at).getTime() >= monthStart).length;

  // Plan distribution across every business (untiered businesses grouped under "none").
  const mixMap = new Map<string, number>();
  for (const b of businesses) {
    const key = b.subscription_tier ?? "none";
    mixMap.set(key, (mixMap.get(key) ?? 0) + 1);
  }
  const planMix = [...mixMap.entries()]
    .map(([planKey, count]) => ({ planKey, count }))
    .sort((a, b) => b.count - a.count);

  const activeSubs = subs.filter((s) => (s.status as SubscriptionStatus) === "active");
  const mrr = activeSubs.reduce((sum, s) => {
    const amount = Number(s.amount) || 0;
    return sum + (s.cycle === "year" ? amount / 12 : amount);
  }, 0);

  const currency =
    activeSubs[0]?.currency ?? businesses[0]?.currency ?? "NGN";

  const recent: RecentBusiness[] = businesses.slice(0, 6).map((b) => ({
    id: b.id,
    name: b.name,
    planKey: b.subscription_tier,
    createdAt: b.created_at,
  }));

  return {
    totalBusinesses: businesses.length,
    activeSubscriptions: activeSubs.length,
    newThisMonth,
    mrr: Math.round(mrr),
    currency,
    planMix,
    recent,
  };
}
