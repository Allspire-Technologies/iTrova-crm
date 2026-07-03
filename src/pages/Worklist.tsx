import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  listWorklist,
  updateWorklistStatus,
  statusGroup,
  isEditableKind,
  KIND_LABELS,
  STATUS_OPTIONS,
  type WorklistItem,
  type WorklistKind,
  type WorklistFilter,
  type StatusGroup,
} from "@/lib/worklist";
import { useAuth } from "@/contexts/AuthContext";
import { roleCanWrite } from "@/lib/roles";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const KINDS: WorklistKind[] = ["note", "ticket", "feature", "feedback", "task"];
// Which "write area" (roles.ts) gates each editable kind's status control.
const WRITE_AREA: Record<"ticket" | "feature" | "task", string> = { ticket: "tickets", feature: "features", task: "tasks" };

// A short secondary descriptor per item, so the unified list keeps each kind's key context.
function meta(item: WorklistItem): string | null {
  switch (item.kind) {
    case "note": return item.sub_type ? `${item.sub_type} note` : "Note";
    case "ticket": return item.priority ? `${item.priority} priority` : null;
    case "feature": return item.votes != null ? `${item.votes} vote${item.votes === 1 ? "" : "s"}` : null;
    case "feedback": return item.rating != null ? `${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}` : "Feedback";
    case "task": return [item.sub_type?.replace("_", " "), item.due_date ? `due ${item.due_date}` : null].filter(Boolean).join(" · ") || null;
  }
}

export default function Worklist() {
  const navigate = useNavigate();
  const role = useAuth().role;
  const [filter, setFilter] = useState<WorklistFilter>({});
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<WorklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const filterKey = useMemo(() => JSON.stringify(filter), [filter]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    listWorklist(filter)
      .then((r) => !cancelled && setItems(r))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load the worklist."));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, reloadKey]);

  async function changeStatus(item: WorklistItem, status: string) {
    const prev = items ?? [];
    setItems((list) => (list ?? []).map((i) => (i.id === item.id && i.kind === item.kind ? { ...i, status } : i)));
    try {
      await updateWorklistStatus(item, status);
    } catch (e) {
      setItems(prev);
      toast.error((e as { message?: string })?.message ?? "Couldn't update the status.");
    }
  }

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => (items ?? []).filter((i) => !q || (i.title ?? "").toLowerCase().includes(q) || (i.business_name ?? "").toLowerCase().includes(q)),
    [items, q],
  );
  const hasFilter = Boolean(filter.kind || filter.group || q);

  function StatusCell({ item, className }: { item: WorklistItem; className?: string }) {
    if (!isEditableKind(item.kind)) {
      const g = statusGroup(item);
      return <Badge variant="secondary" className="capitalize">{g ?? "logged"}</Badge>;
    }
    const canWrite = roleCanWrite(role, WRITE_AREA[item.kind]);
    return (
      <select
        className={cn(selectClass, "disabled:cursor-not-allowed disabled:opacity-60", className)}
        disabled={!canWrite}
        value={item.status ?? ""}
        onChange={(e) => changeStatus(item, e.target.value)}
        aria-label={`Status for ${item.title ?? item.kind}`}
      >
        {STATUS_OPTIONS[item.kind].map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  const Customer = ({ item }: { item: WorklistItem }) =>
    item.business_id ? (
      <button type="button" onClick={() => navigate(`/customers/${item.business_id}`)} className="text-brand-dark underline-offset-2 hover:underline">
        {item.business_name ?? "Business"}
      </button>
    ) : (
      <span className="text-muted-foreground">General</span>
    );

  return (
    <>
      <PageHeader title="Worklist" subtitle="Every note, ticket, feature request, feedback and task across customers — in one place. Update status without leaving the page." />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={selectClass} value={filter.kind ?? ""} onChange={(e) => setFilter((f) => ({ ...f, kind: (e.target.value || undefined) as WorklistKind | undefined }))} aria-label="Filter by type">
          <option value="">All types</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        <select className={selectClass} value={filter.group ?? ""} onChange={(e) => setFilter((f) => ({ ...f, group: (e.target.value || undefined) as StatusGroup | undefined }))} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="open">Open / needs attention</option>
          <option value="closed">Closed / done</option>
        </select>
        <Input className="h-9 w-full sm:w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or customer…" aria-label="Search worklist" />
        {hasFilter && (
          <button type="button" onClick={() => { setFilter({}); setSearch(""); }} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : items === null ? (
        <LoadingState label="Loading worklist…" />
      ) : visible.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nothing here" description={hasFilter ? "No items match these filters." : "Items added to a customer's Notes & CRM section will show up here."} />
      ) : (
        <>
        <div className="hidden rounded-xl border border-border/60 bg-card sm:block">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => (
                <TableRow key={`${item.kind}-${item.id}`} className="hover:bg-transparent">
                  <TableCell className="align-top"><Badge variant="outline" className="whitespace-nowrap">{KIND_LABELS[item.kind]}</Badge></TableCell>
                  <TableCell className="max-w-[28rem] align-top">
                    <p className="line-clamp-2 font-medium text-brand-dark">{item.title || "—"}</p>
                    {meta(item) && <p className="mt-0.5 text-xs capitalize text-muted-foreground">{meta(item)}</p>}
                  </TableCell>
                  <TableCell className="align-top"><Customer item={item} /></TableCell>
                  <TableCell className="align-top"><StatusCell item={item} /></TableCell>
                  <TableCell className="whitespace-nowrap align-top text-muted-foreground">{formatRelative(item.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Cards (mobile) */}
        <div className="space-y-2 sm:hidden">
          {visible.map((item) => (
            <div key={`${item.kind}-${item.id}`} className="rounded-xl border border-border/60 bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-brand-dark">{item.title || "—"}</span>
                <Badge variant="outline" className="shrink-0 whitespace-nowrap">{KIND_LABELS[item.kind]}</Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <Customer item={item} />
                {meta(item) && <span className="capitalize">{meta(item)}</span>}
                <span>{formatRelative(item.created_at)}</span>
              </div>
              <div className="mt-2"><StatusCell item={item} className="w-full" /></div>
            </div>
          ))}
        </div>
        </>
      )}
    </>
  );
}
