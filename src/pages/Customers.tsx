import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Building2, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubscriptionBadge, PlanBadge } from "@/components/SubscriptionBadge";
import { HealthBadge } from "@/components/HealthBadge";
import {
  listCustomersPage,
  type CustomersPage,
  type CustomersQuery,
  type CustomersSort,
  type SubscriptionStatus,
} from "@/lib/customers";
import { getCustomersFacets, type CustomersFacets } from "@/lib/admin";
import { accountAssignment } from "@/lib/cs";
import type { HealthBand } from "@/lib/cs";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const BANDS: { value: HealthBand; label: string }[] = [
  { value: "red", label: "Critical" },
  { value: "yellow", label: "Warning" },
  { value: "green", label: "Healthy" },
];

const SUB_STATUSES: { value: SubscriptionStatus; label: string }[] = [
  { value: "trialing", label: "Trialing" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
  { value: "expired", label: "Expired" },
];

// Quick-filter presets the Dashboard Home KPI cards link to (?filter=…). They translate
// into the same server-side predicates the toolbar exposes.
const PRESETS: Record<string, string> = {
  active: "Active",
  trial: "Trial",
  paying: "Paying",
  renewal_due: "Renewal due",
  new_this_month: "New this month",
  at_risk: "At risk",
};

// Sort directions that read more naturally "high/recent first" on the first click.
const DESC_FIRST = new Set<CustomersSort>(["joined", "last_login", "renewal", "sales", "products", "users"]);

function buildQuery(params: URLSearchParams): CustomersQuery {
  const g = (k: string) => params.get(k) || undefined;
  const manager = g("manager");
  const q: CustomersQuery = {
    search: g("q"),
    band: g("band") as HealthBand | undefined,
    plan: g("plan"),
    subscriptionStatus: g("sub") as SubscriptionStatus | undefined,
    industry: g("industry"),
    accountManager: manager && manager !== "none" ? manager : undefined,
    unassigned: manager === "none" || undefined,
    renewalDue: params.get("renewal") === "1" || undefined,
    atRisk: params.get("risk") === "1" || undefined,
    sort: (g("sort") as CustomersSort) ?? "health",
    dir: (g("dir") as "asc" | "desc") ?? "asc",
    page: Number(params.get("page") || 1),
    pageSize: PAGE_SIZE,
  };
  switch (params.get("filter")) {
    case "active":
      q.active = true;
      break;
    case "trial":
      q.subscriptionStatus = "trialing";
      break;
    case "paying":
      q.subscriptionStatus = "active";
      break;
    case "renewal_due":
      q.renewalDue = true;
      break;
    case "new_this_month":
      q.newThisMonth = true;
      break;
    case "at_risk":
      q.atRisk = true;
      break;
  }
  return q;
}

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function Customers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();

  const [data, setData] = useState<CustomersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [facets, setFacets] = useState<CustomersFacets | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkManager, setBulkManager] = useState("");
  const [assigning, setAssigning] = useState(false);

  // Search box keeps its own (debounced) state so typing stays snappy.
  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");

  const q = useMemo(() => buildQuery(new URLSearchParams(paramsKey)), [paramsKey]);
  const cur = (k: string) => searchParams.get(k) ?? "";

  useEffect(() => {
    getCustomersFacets()
      .then(setFacets)
      .catch(() => setFacets({ plans: [], industries: [], managers: [] }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCustomersPage(buildQuery(new URLSearchParams(paramsKey)))
      .then((p) => {
        if (cancelled) return;
        setData(p);
        setSelected(new Set());
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load customers.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paramsKey, reloadKey]);

  // Debounce the search input into the URL (resets to page 1).
  useEffect(() => {
    const t = setTimeout(() => {
      if ((searchParams.get("q") ?? "") !== searchInput) update({ q: searchInput || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function update(patch: Record<string, string | null>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === "") next.delete(k);
          else next.set(k, v);
        }
        if (!("page" in patch)) next.delete("page"); // any filter/sort change returns to page 1
        return next;
      },
      { replace: true },
    );
  }

  function toggleSort(col: CustomersSort) {
    const dir = q.sort === col ? (q.dir === "asc" ? "desc" : "asc") : DESC_FIRST.has(col) ? "desc" : "asc";
    update({ sort: col, dir });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkAssign() {
    if (bulkManager === "" || selected.size === 0) return;
    setAssigning(true);
    try {
      await accountAssignment.setMany([...selected], bulkManager === "none" ? null : bulkManager);
      const n = selected.size;
      toast.success(`Updated ${n} ${n === 1 ? "business" : "businesses"}.`);
      setSelected(new Set());
      setBulkManager("");
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't update assignments.");
    } finally {
      setAssigning(false);
    }
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNum = q.page ?? 1;
  const from = total === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1;
  const to = Math.min(pageNum * PAGE_SIZE, total);

  const pageIds = rows.map((r) => r.businessId);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id));
  const headerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  // Active-filter chips.
  const chips: { label: string; clear: () => void }[] = [];
  const preset = cur("filter");
  if (preset && PRESETS[preset]) chips.push({ label: PRESETS[preset], clear: () => update({ filter: null }) });
  if (cur("q")) chips.push({ label: `“${cur("q")}”`, clear: () => { setSearchInput(""); update({ q: null }); } });
  if (q.band) chips.push({ label: BANDS.find((b) => b.value === q.band)?.label ?? q.band, clear: () => update({ band: null }) });
  if (cur("plan")) chips.push({ label: cur("plan"), clear: () => update({ plan: null }) });
  if (cur("sub")) {
    const lbl = SUB_STATUSES.find((s) => s.value === cur("sub"))?.label ?? cur("sub");
    chips.push({ label: lbl, clear: () => update({ sub: null }) });
  }
  if (cur("industry")) chips.push({ label: cur("industry"), clear: () => update({ industry: null }) });
  if (cur("manager")) {
    const m = cur("manager");
    const lbl = m === "none" ? "Unassigned" : facets?.managers.find((x) => x.id === m)?.name ?? "Account manager";
    chips.push({ label: lbl, clear: () => update({ manager: null }) });
  }
  if (cur("renewal") === "1") chips.push({ label: "Renewal due", clear: () => update({ renewal: null }) });
  if (cur("risk") === "1") chips.push({ label: "At risk", clear: () => update({ risk: null }) });

  const SortHead = ({ col, label, align }: { col: CustomersSort; label: string; align?: "right" }) => {
    const active = q.sort === col;
    return (
      <TableHead className={align === "right" ? "text-right" : undefined}>
        <button
          type="button"
          onClick={() => toggleSort(col)}
          className={cn(
            "inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground",
            align === "right" && "flex-row-reverse",
            active && "text-foreground",
          )}
        >
          {label}
          {active && (q.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      </TableHead>
    );
  };

  if (error && !data) {
    return (
      <>
        <PageHeader title="Customers" subtitle="Every business using iTrova." />
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Customers" subtitle="Every business using iTrova." />
        <LoadingState label="Loading customers…" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${total} ${total === 1 ? "business" : "businesses"}${chips.length ? " match your filters" : " on iTrova"}`}
      />

      <div className="space-y-4">
        {/* Toolbar: search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, owner or email…"
              className="pl-9"
            />
          </div>

          <select className={selectClass} value={cur("band")} onChange={(e) => update({ band: e.target.value })} aria-label="Health band">
            <option value="">All health</option>
            {BANDS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>

          <select className={selectClass} value={cur("plan")} onChange={(e) => update({ plan: e.target.value })} aria-label="Plan">
            <option value="">All plans</option>
            {facets?.plans.map((p) => (
              <option key={p} value={p} className="capitalize">{p}</option>
            ))}
          </select>

          <select className={selectClass} value={cur("sub")} onChange={(e) => update({ sub: e.target.value })} aria-label="Subscription status">
            <option value="">All statuses</option>
            {SUB_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {facets && facets.industries.length > 0 && (
            <select className={selectClass} value={cur("industry")} onChange={(e) => update({ industry: e.target.value })} aria-label="Industry">
              <option value="">All industries</option>
              {facets.industries.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          )}

          <select className={selectClass} value={cur("manager")} onChange={(e) => update({ manager: e.target.value })} aria-label="Account manager">
            <option value="">All managers</option>
            <option value="none">Unassigned</option>
            {facets?.managers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => update({ renewal: cur("renewal") === "1" ? null : "1" })}
            className={cn(
              "h-9 rounded-md border px-3 text-sm transition-colors",
              cur("renewal") === "1"
                ? "border-brand/40 bg-secondary text-brand-dark"
                : "border-input bg-background text-muted-foreground hover:bg-secondary/50",
            )}
          >
            Renewal due
          </button>
          <button
            type="button"
            onClick={() => update({ risk: cur("risk") === "1" ? null : "1" })}
            className={cn(
              "h-9 rounded-md border px-3 text-sm transition-colors",
              cur("risk") === "1"
                ? "border-brand/40 bg-secondary text-brand-dark"
                : "border-input bg-background text-muted-foreground hover:bg-secondary/50",
            )}
          >
            At risk
          </button>
        </div>

        {/* Active filter chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={c.clear}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-secondary px-3 py-1 text-sm font-medium text-brand-dark transition-colors hover:bg-secondary/70"
              >
                {c.label}
                <X className="size-3.5" />
              </button>
            ))}
            <button type="button" onClick={() => navigate("/customers")} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
              Clear all
            </button>
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-secondary/50 px-4 py-2.5">
            <span className="text-sm font-medium text-brand-dark">{selected.size} selected</span>
            <select className={selectClass} value={bulkManager} onChange={(e) => setBulkManager(e.target.value)} aria-label="Assign account manager">
              <option value="">Assign account manager…</option>
              <option value="none">Unassign</option>
              {facets?.managers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={applyBulkAssign} disabled={bulkManager === "" || assigning}>
              {assigning ? "Applying…" : "Apply"}
            </Button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-sm text-muted-foreground hover:text-foreground">
              Clear selection
            </button>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-border/60 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <input
                    ref={headerRef}
                    type="checkbox"
                    className="size-4 cursor-pointer accent-brand align-middle"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all on this page"
                  />
                </TableHead>
                <SortHead col="name" label="Business" />
                <SortHead col="industry" label="Industry" />
                <SortHead col="plan" label="Plan" />
                <SortHead col="status" label="Subscription" />
                <SortHead col="joined" label="Joined" />
                <SortHead col="products" label="Products" align="right" />
                <SortHead col="sales" label="Sales" align="right" />
                <SortHead col="users" label="Staff" align="right" />
                <SortHead col="last_login" label="Last login" />
                <SortHead col="renewal" label="Renewal" />
                <SortHead col="health" label="Score" align="right" />
                <SortHead col="manager" label="Account manager" />
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.businessId}
                  data-state={selected.has(r.businessId) ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => navigate(`/customers/${r.businessId}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-brand align-middle"
                      checked={selected.has(r.businessId)}
                      onChange={() => toggleSelect(r.businessId)}
                      aria-label={`Select ${r.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-brand-dark">{r.name}</div>
                    {r.ownerName && <div className="text-xs text-muted-foreground">{r.ownerName}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.industry ?? "—"}</TableCell>
                  <TableCell><PlanBadge planKey={r.planKey} /></TableCell>
                  <TableCell><SubscriptionBadge status={r.subscriptionStatus} /></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.joinedAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.productsTotal}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.salesCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalUsers}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(r.lastLogin)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.renewalDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.healthScore ?? "—"}</TableCell>
                  <TableCell className={r.accountManagerName ? "text-foreground" : "text-muted-foreground"}>
                    {r.accountManagerName ?? "Unassigned"}
                  </TableCell>
                  <TableCell><HealthBadge band={r.healthBand} /></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={14} className="py-12">
                    <EmptyState
                      icon={Building2}
                      title="No businesses match"
                      description="Try widening or clearing your filters."
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>
            {total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}
            {loading && <span className="ml-2 opacity-70">Updating…</span>}
          </span>
          <div className="flex items-center gap-2">
            <span>Page {pageNum} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={pageNum <= 1} onClick={() => update({ page: String(pageNum - 1) })}>
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={pageNum >= totalPages} onClick={() => update({ page: String(pageNum + 1) })}>
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
