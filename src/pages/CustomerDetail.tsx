import { lazy, Suspense, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Building2, Clock, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubscriptionBadge, PlanBadge } from "@/components/SubscriptionBadge";
import { HealthBadge } from "@/components/HealthBadge";
import { StatCard } from "@/components/StatCard";
import { LazyInView } from "@/components/LazyInView";
import { Sparkline } from "@/components/charts/Charts";
import { UsageSection } from "@/components/customer/UsageSection";
import { WorkflowSection } from "@/components/customer/WorkflowSection";
import { getCustomer, type CustomerDetail as Detail } from "@/lib/customers";
import { getCurrentHealth, listHealthHistory } from "@/lib/health";
import { pipeline } from "@/lib/cs";
import type { CsPipeline, HealthBand, PipelineStage } from "@/lib/cs";
import { useAuth } from "@/contexts/AuthContext";
import { roleSeesRevenue } from "@/lib/roles";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";

const CrmTabs = lazy(() => import("@/components/customer/CrmTabs"));

const STAGE_LABELS: Record<PipelineStage, string> = {
  lead: "Lead",
  registered: "Registered",
  subscribed: "Subscribed",
  onboarding: "Onboarding",
  active: "Active",
  power_user: "Power user",
  renewed: "Renewed",
  churned: "Churned",
};

type Health = { score: number; band: HealthBand; reasons: unknown } | null;

function reasonList(reasons: unknown): string[] {
  if (!Array.isArray(reasons)) return [];
  return reasons.map((r) => {
    if (typeof r === "string") return r;
    if (r && typeof r === "object") {
      const o = r as Record<string, unknown>;
      return String(o.label ?? o.reason ?? o.message ?? JSON.stringify(o));
    }
    return String(r);
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-brand-dark">{children}</dd>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 font-display text-lg font-semibold text-brand-dark">{children}</h2>;
}

export default function CustomerDetail() {
  const { id } = useParams();
  const seesRevenue = roleSeesRevenue(useAuth().role); // subscription amount / revenue are admin-only (§3)
  const [data, setData] = useState<Detail | null | undefined>(undefined);
  const [health, setHealth] = useState<Health>(null);
  const [stage, setStage] = useState<CsPipeline | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setData(undefined);
    setError(null);
    Promise.all([
      getCustomer(id),
      getCurrentHealth(id).catch(() => null),
      pipeline.get(id).catch(() => null),
      listHealthHistory(id).catch(() => []),
    ])
      .then(([d, h, p, hist]) => {
        if (cancelled) return;
        setData(d);
        setHealth(h ? { score: h.score, band: h.band, reasons: h.reasons } : null);
        setStage(p);
        // History comes back newest-first; chart wants oldest→newest. Last ~30 points.
        setScores([...hist].reverse().slice(-30).map((s) => s.score));
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load this customer.");
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const back = (
    <Button variant="outline" size="sm" asChild>
      <Link to="/customers"><ArrowLeft className="size-4" /> Back to customers</Link>
    </Button>
  );

  if (error) {
    return (
      <>
        <PageHeader title="Customer detail" action={back} />
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </>
    );
  }

  if (data === undefined) {
    return (
      <>
        <PageHeader title="Customer detail" action={back} />
        <LoadingState label="Loading customer…" />
      </>
    );
  }

  if (data === null) {
    return (
      <>
        <PageHeader title="Customer detail" action={back} />
        <EmptyState icon={Building2} title="Customer not found" description="This business does not exist or is no longer accessible." />
      </>
    );
  }

  const sub = data.subscription;
  const owner = data.team.find((m) => m.isOwner);
  const reasons = reasonList(health?.reasons);

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={`Joined ${formatDate(data.createdAt)} · ${data.team.length} ${data.team.length === 1 ? "member" : "members"}`}
        action={back}
      />

      {/* Profile + Subscription */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Profile</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <HealthBadge band={health?.band ?? null} score={health?.score ?? null} />
              {stage && <Badge variant="secondary">{STAGE_LABELS[stage.stage]}</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Business">{data.name}</Field>
              <Field label="Owner">{owner?.name ?? "—"}</Field>
              <Field label="Phone">{owner?.phone ?? data.whatsappNumber ?? "—"}</Field>
              <Field label="Email">{data.ownerEmail ?? "—"}</Field>
              <Field label="Industry">{data.industry ?? "—"}</Field>
              <Field label="Plan"><PlanBadge planKey={data.planKey} /></Field>
              <Field label="Renewal date">{formatDate(sub?.currentPeriodEnd)}</Field>
              <Field label="Pipeline stage">{stage ? STAGE_LABELS[stage.stage] : "—"}</Field>
            </dl>
            {scores.length >= 2 && (
              <div className="mt-5 flex items-center justify-between gap-4 border-t border-border/60 pt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Health trend</p>
                <Sparkline
                  values={scores}
                  width={180}
                  height={36}
                  className="w-40 shrink-0"
                  ariaLabel={`Health score over the last ${scores.length} snapshots, currently ${scores[scores.length - 1]}`}
                />
              </div>
            )}
            {reasons.length > 0 && (
              <div className="mt-5 border-t border-border/60 pt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Health reasons</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-foreground">
                  {reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Subscription</CardTitle>
            <SubscriptionBadge status={sub?.status ?? null} />
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
              {seesRevenue && <Field label="Amount">{sub ? formatMoney(sub.amount, sub.currency) : "—"}</Field>}
              <Field label="Cycle"><span className="capitalize">{sub?.cycle ?? "—"}</span></Field>
              <Field label="Started">{formatDate(sub?.startedAt)}</Field>
              <Field label="Currency">{data.currency}</Field>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Customer Success Workflow */}
      <SectionHeading>Customer Success Workflow</SectionHeading>
      <Card>
        <CardContent className="p-5">
          <WorkflowSection
            businessId={data.id}
            onHealthRecomputed={(snap) => setHealth({ score: snap.score, band: snap.band, reasons: snap.reasons })}
          />
        </CardContent>
      </Card>

      {/* Product Usage (lazy) */}
      <SectionHeading>Product Usage</SectionHeading>
      <LazyInView minHeight={180} placeholder={<LoadingState label="Loading usage…" />}>
        <UsageSection businessId={data.id} currency={data.currency} />
      </LazyInView>

      {/* User Activity */}
      <SectionHeading>User Activity</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total users" value={String(data.metrics.totalUsers)} icon={Users} />
        <StatCard label="Active users" value={`${data.metrics.activeUsers}/${data.metrics.totalUsers}`} hint="last 30 days" icon={Users} />
        <StatCard label="Last login" value={formatRelative(data.metrics.lastLogin)} icon={Clock} />
      </div>
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Staff usage</CardTitle>
          <span className="text-sm text-muted-foreground">{data.team.length} total</span>
        </CardHeader>
        <CardContent className="p-0">
          {data.team.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No team members.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.team.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-brand-dark">{m.name ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.phone ?? "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {m.isOwner ? <Badge variant="secondary">Owner</Badge> : <span className="text-xs text-muted-foreground">Member</span>}
                    <span className="text-xs text-muted-foreground">{formatRelative(m.lastSeen)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Notes & CRM (lazy + code-split) */}
      <SectionHeading>Notes &amp; CRM</SectionHeading>
      <Card>
        <CardContent className="p-5">
          <LazyInView minHeight={240} placeholder={<LoadingState label="Loading CRM…" />}>
            <Suspense fallback={<LoadingState label="Loading CRM…" />}>
              <CrmTabs businessId={data.id} />
            </Suspense>
          </LazyInView>
        </CardContent>
      </Card>
    </>
  );
}
