import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, BadgeCheck, Banknote, Sparkles, Receipt, ShoppingCart, Package, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanBadge } from "@/components/SubscriptionBadge";
import { getDashboardStats, type DashboardStats } from "@/lib/dashboard";
import { formatDate, formatMoney } from "@/lib/format";

export default function Home() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);
    getDashboardStats()
      .then((d) => {
        if (!cancelled) setStats(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load dashboard.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of all iTrova businesses." />

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : stats === null ? (
        <LoadingState label="Loading metrics…" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total businesses" value={String(stats.totalBusinesses)} icon={Building2} />
            <StatCard label="Active subscriptions" value={String(stats.activeSubscriptions)} icon={BadgeCheck} />
            <StatCard label="MRR" value={formatMoney(stats.mrr, stats.currency)} hint="Monthly-normalised" icon={Banknote} />
            <StatCard label="New this month" value={String(stats.newThisMonth)} icon={Sparkles} />
            <StatCard label="Revenue recorded" value={formatMoney(stats.totalRevenue, stats.currency)} hint="All businesses" icon={Receipt} />
            <StatCard label="Sales recorded" value={String(stats.totalSales)} icon={ShoppingCart} />
            <StatCard label="Products" value={String(stats.totalProducts)} icon={Package} />
            <StatCard
              label="Avg revenue / business"
              value={formatMoney(stats.totalBusinesses ? Math.round(stats.totalRevenue / stats.totalBusinesses) : 0, stats.currency)}
              icon={TrendingUp}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Plan distribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {stats.planMix.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No businesses yet.</p>
                ) : (
                  stats.planMix.map((p) => (
                    <div key={p.planKey} className="flex items-center justify-between">
                      <PlanBadge planKey={p.planKey === "none" ? null : p.planKey} />
                      <span className="text-sm font-medium tabular-nums text-brand-dark">{p.count}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Recent signups</CardTitle>
                <Link to="/customers" className="text-sm font-medium text-brand hover:underline">
                  View all
                </Link>
              </CardHeader>
              <CardContent className="space-y-1">
                {stats.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No businesses yet.</p>
                ) : (
                  stats.recent.map((b) => (
                    <Link
                      key={b.id}
                      to={`/customers/${b.id}`}
                      className="flex items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-secondary/50"
                    >
                      <span className="font-medium text-brand-dark">{b.name}</span>
                      <span className="flex items-center gap-3">
                        <PlanBadge planKey={b.planKey} />
                        <span className="text-sm text-muted-foreground">{formatDate(b.createdAt)}</span>
                      </span>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
