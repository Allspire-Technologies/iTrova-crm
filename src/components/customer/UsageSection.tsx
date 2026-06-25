import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { getBusinessUsage, type BusinessUsage, type UsageMetric } from "@/lib/admin";
import { formatMoney } from "@/lib/format";

function Tile({
  label,
  total,
  metric,
  money,
  currency,
  note,
}: {
  label: string;
  total: string;
  metric?: UsageMetric;
  money?: boolean;
  currency?: string;
  note?: string;
}) {
  const fmt = (n: number) => (money ? formatMoney(n, currency) : String(n));
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-2xl font-bold text-brand-dark">{total}</p>
        {note ? (
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        ) : metric ? (
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">+{fmt(metric.d30)}</span> · 30d
            <span className="mx-1.5 text-border">|</span>
            <span className="font-medium text-foreground">+{fmt(metric.d90)}</span> · 90d
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function UsageSection({ businessId, currency }: { businessId: string; currency: string }) {
  const [usage, setUsage] = useState<BusinessUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    setError(null);
    getBusinessUsage(businessId)
      .then((u) => !cancelled && setUsage(u))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load usage."));
    return () => {
      cancelled = true;
    };
  }, [businessId, reloadKey]);

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!usage) return <LoadingState label="Loading usage trends…" />;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Tile label="Products Created" total={String(usage.products.total)} metric={usage.products} />
      <Tile label="Products Updated" total="—" note="Not tracked by iTrova" />
      <Tile label="Stock Movements" total={String(usage.stock.total)} metric={usage.stock} />
      <Tile label="Purchase Orders" total={String(usage.purchaseOrders.total)} metric={usage.purchaseOrders} />
      <Tile label="Sales Transactions" total={String(usage.sales.total)} metric={usage.sales} />
      <Tile
        label="Revenue Recorded"
        total={formatMoney(usage.revenue.total, currency)}
        metric={usage.revenue}
        money
        currency={currency}
      />
    </div>
  );
}
