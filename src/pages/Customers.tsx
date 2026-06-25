import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubscriptionBadge, PlanBadge } from "@/components/SubscriptionBadge";
import { listCustomers, type CustomerRow } from "@/lib/customers";
import { formatDate, formatMoney } from "@/lib/format";

export default function Customers() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    listCustomers()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load customers.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.ownerName ?? "").toLowerCase().includes(q) ||
        (r.planKey ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={rows ? `${rows.length} ${rows.length === 1 ? "business" : "businesses"} on iTrova` : "Every business using iTrova."}
      />

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : rows === null ? (
        <LoadingState label="Loading customers…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No customers yet"
          description="Businesses that sign up on iTrova will appear here with their plan, status and owner."
        />
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by business, owner or plan…"
              className="pl-9"
            />
          </div>

          <div className="rounded-xl border border-border/60 bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Business</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/customers/${r.id}`)}
                  >
                    <TableCell className="font-medium text-brand-dark">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.ownerName ?? "—"}</TableCell>
                    <TableCell><PlanBadge planKey={r.planKey} /></TableCell>
                    <TableCell><SubscriptionBadge status={r.status} /></TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.amount != null ? formatMoney(r.amount, r.currency) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.revenueRecorded, r.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.totalUsers}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      No businesses match “{query}”.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </>
  );
}
