import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubscriptionBadge, PlanBadge } from "@/components/SubscriptionBadge";
import { listCustomersPage, type CustomerPageRow } from "@/lib/customers";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 25;

/**
 * Renewals module — pick a customer to see / record their renewal payment records
 * (Ref No + notes). The list reuses the server-side customers page RPC, sorted by
 * the soonest renewal first.
 */
export default function Renewals() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CustomerPageRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce the search box into the server-side query (Settings convention).
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    listCustomersPage({ search: query || undefined, sort: "renewal", dir: "asc", page, pageSize: PAGE_SIZE })
      .then((p) => {
        if (cancelled) return;
        setRows(p.rows);
        setTotal(p.total);
      })
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load customers."));
    return () => {
      cancelled = true;
    };
  }, [query, page, reloadKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const open = (r: CustomerPageRow) => navigate(`/renewals/${r.businessId}`);

  return (
    <>
      <PageHeader title="Renewals" subtitle="Pick a customer to view or record their renewal payments (Ref No, notes)." />

      <div className="space-y-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search businesses…"
          aria-label="Search businesses"
          className="max-w-sm"
        />

        {error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows === null ? (
          <LoadingState label="Loading customers…" />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No businesses match{query ? ` “${query}”` : ""}.</p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden rounded-xl border border-border/60 md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Business</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Renewal date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.businessId} className="cursor-pointer" onClick={() => open(r)}>
                      <TableCell className="font-medium text-brand-dark">{r.name}</TableCell>
                      <TableCell><PlanBadge planKey={r.planKey} /></TableCell>
                      <TableCell><SubscriptionBadge status={r.subscriptionStatus} /></TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(r.renewalDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.businessId}>
                  <button
                    type="button"
                    onClick={() => open(r)}
                    className="w-full rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-brand/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-brand-dark">{r.name}</span>
                      <SubscriptionBadge status={r.subscriptionStatus} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <PlanBadge planKey={r.planKey} />
                      <span>Renews {formatDate(r.renewalDate)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {/* Pagination (Customers convention) */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {total} {total === 1 ? "business" : "businesses"} · page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="size-4" /> Prev
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
