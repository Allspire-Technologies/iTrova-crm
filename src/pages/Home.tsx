import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Building2,
  CalendarClock,
  FlaskConical,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getHomeData, type HomeData } from "@/lib/home";
import { formatDate, formatMoney } from "@/lib/format";

export default function Home() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getHomeData()
      .then((d) => {
        if (!cancelled) setData(d);
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
      ) : data === null ? (
        <LoadingState label="Loading metrics…" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <StatCard label="Total Businesses" value={String(data.kpis.totalBusinesses)} icon={Building2} to="/customers" />
            <StatCard label="Active Businesses" value={String(data.kpis.activeBusinesses)} hint="≥1 login in 30 days" icon={Activity} to="/customers?filter=active" />
            <StatCard label="Trial Businesses" value={String(data.kpis.trialBusinesses)} icon={FlaskConical} to="/customers?filter=trial" />
            <StatCard label="Paying Businesses" value={String(data.kpis.payingBusinesses)} icon={BadgeCheck} to="/customers?filter=paying" />
            <StatCard label="MRR" value={formatMoney(data.kpis.mrr, data.kpis.currency)} hint="Monthly-normalised" icon={Banknote} to="/customers?filter=paying" />
            <StatCard label="ARR" value={formatMoney(data.kpis.arr, data.kpis.currency)} hint="MRR × 12" icon={TrendingUp} to="/customers?filter=paying" />
            <StatCard label="Businesses At Risk" value={String(data.kpis.atRisk)} hint="Red band or churn/renewal alert" icon={AlertTriangle} to="/customers?filter=at_risk" />
            <StatCard label="Due For Renewal" value={String(data.kpis.dueRenewal)} hint="Next 14 days" icon={CalendarClock} to="/customers?filter=renewal_due" />
            <StatCard label="New This Month" value={String(data.kpis.newThisMonth)} icon={Sparkles} to="/customers?filter=new_this_month" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-destructive" /> At-risk customers
                </CardTitle>
                <span className="text-sm text-muted-foreground">{data.atRisk.length}</span>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.atRisk.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No customers currently at risk.</p>
                ) : (
                  data.atRisk.map((r) => (
                    <Link
                      key={r.businessId}
                      to={`/customers/${r.businessId}`}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-brand-dark">{r.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.reason}</span>
                      </span>
                      <Badge variant={r.severity === "critical" ? "destructive" : "secondary"}>{r.severity}</Badge>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="size-4 text-brand" /> Renewals due
                </CardTitle>
                <span className="text-sm text-muted-foreground">Next 14 days</span>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.renewals.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No renewals in the next 14 days.</p>
                ) : (
                  data.renewals.map((r) => (
                    <Link
                      key={r.businessId}
                      to={`/customers/${r.businessId}`}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-brand-dark">{r.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{formatDate(r.renewalDate)}</span>
                      </span>
                      <Badge variant={r.daysLeft <= 3 ? "destructive" : "secondary"}>
                        {r.daysLeft === 0 ? "today" : `${r.daysLeft}d`}
                      </Badge>
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
