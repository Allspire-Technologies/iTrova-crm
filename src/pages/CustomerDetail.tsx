import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Building2, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubscriptionBadge, PlanBadge } from "@/components/SubscriptionBadge";
import { getCustomer, type CustomerDetail as Detail } from "@/lib/customers";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-brand-dark">{children}</dd>
    </div>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const [data, setData] = useState<Detail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setData(undefined);
    setError(null);
    getCustomer(id)
      .then((d) => {
        if (!cancelled) setData(d);
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

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={`Joined ${formatDate(data.createdAt)} · ${data.team.length} ${data.team.length === 1 ? "member" : "members"}`}
        action={back}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Subscription</CardTitle>
            <SubscriptionBadge status={sub?.status ?? null} />
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Field label="Plan"><PlanBadge planKey={data.planKey} /></Field>
              <Field label="Amount">{sub ? formatMoney(sub.amount, sub.currency) : "—"}</Field>
              <Field label="Billing cycle"><span className="capitalize">{sub?.cycle ?? "—"}</span></Field>
              <Field label="Renews">{formatDate(sub?.currentPeriodEnd)}</Field>
              <Field label="Started">{formatDate(sub?.startedAt)}</Field>
              <Field label="Currency">{data.currency}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-y-5">
              <Field label="Timezone">{data.timezone ?? "—"}</Field>
              <Field label="WhatsApp">{data.whatsappNumber ?? "—"}</Field>
              <Field label="Business ID"><span className="font-mono text-xs">{data.id}</span></Field>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Team</CardTitle>
          <span className="text-sm text-muted-foreground">{data.team.length} total</span>
        </CardHeader>
        <CardContent className="p-0">
          {data.team.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No team members.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.team.map((m) => (
                  <TableRow key={m.id} className="hover:bg-transparent">
                    <TableCell className="font-medium text-brand-dark">{m.name ?? "—"}</TableCell>
                    <TableCell>
                      {m.isOwner ? <Badge variant="secondary">Owner</Badge> : <span className="text-muted-foreground">Member</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.phone ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatRelative(m.lastSeen)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
