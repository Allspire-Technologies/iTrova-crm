import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Mail, Search, Send } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BulkMessageDialog } from "@/components/BulkMessageDialog";
import { listMessageLog, type MessageLogEntry, type MessageStatus } from "@/lib/messaging";
import { formatRelative } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { roleCanMessageCustomers } from "@/lib/roles";

const PAGE_SIZE = 50;

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const STATUSES: { value: MessageStatus; label: string }[] = [
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Queued" },
];

function StatusBadge({ status }: { status: MessageStatus }) {
  return <Badge variant={status === "failed" ? "destructive" : "secondary"} className="capitalize">{status}</Badge>;
}

export default function Messages() {
  const navigate = useNavigate();
  const canSend = roleCanMessageCustomers(useAuth().role);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | MessageStatus>("");
  const [rows, setRows] = useState<MessageLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [composing, setComposing] = useState(false);

  // Debounce the search box so typing stays snappy.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change returns to the first page.
  useEffect(() => { setPage(1); }, [debouncedSearch, status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMessageLog({ search: debouncedSearch, status: status || null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load messages.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, status, page, reloadKey]);

  const subtitle = useMemo(() => {
    if (rows == null) return "Every customer email sent from the CRM.";
    return `${total} ${total === 1 ? "message" : "messages"}${search || status ? " match your filters" : ""}`;
  }, [rows, total, search, status]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  const sendButton = canSend ? (
    <Button onClick={() => setComposing(true)}><Send className="size-4" /> Send message</Button>
  ) : undefined;

  if (error && rows == null) {
    return (
      <>
        <PageHeader title="Messages" subtitle="Every customer email sent from the CRM." action={sendButton} />
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        <BulkMessageDialog open={composing} onOpenChange={setComposing} onSent={() => setReloadKey((k) => k + 1)} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Messages" subtitle={subtitle} action={sendButton} />

      <div className="space-y-4">
        {/* Toolbar: search + status filter */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, customer or recipient…"
              className="pl-9"
            />
          </div>
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as "" | MessageStatus)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {rows == null ? (
          <LoadingState label="Loading messages…" />
        ) : total === 0 ? (
          <EmptyState
            icon={Mail}
            title="No messages yet"
            description={search || status ? "Try widening or clearing your filters." : "Emails you send to customers from their Messages tab will appear here."}
          />
        ) : (
          <>
            {/* Table (desktop) */}
            <div className="hidden rounded-xl border border-border/60 bg-card sm:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Sent by</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => (
                    <TableRow key={m.id} className="cursor-pointer" onClick={() => navigate(`/customers/${m.businessId}`)}>
                      <TableCell>
                        <div className="font-medium text-brand-dark">{m.businessName}</div>
                        <div className="text-xs text-muted-foreground">{m.toEmail}</div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[28rem] truncate text-foreground">{m.subject}</div>
                        {m.error && <div className="max-w-[28rem] truncate text-xs text-destructive">{m.error}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{m.sentByName ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={m.status} /></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(m.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Cards (mobile) */}
            <div className="space-y-2 sm:hidden">
              {rows.map((m) => (
                <div
                  key={m.id}
                  onClick={() => navigate(`/customers/${m.businessId}`)}
                  className="cursor-pointer rounded-xl border border-border/60 bg-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-brand-dark">{m.businessName}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.toEmail}</div>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="mt-2 truncate text-sm text-foreground">{m.subject}</div>
                  {m.error && <div className="mt-1 truncate text-xs text-destructive">{m.error}</div>}
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{m.sentByName ? `by ${m.sentByName}` : "—"}</span>
                    <span>{formatRelative(m.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
              <span>
                Showing {from}–{to} of {total}
                {loading && <span className="ml-2 opacity-70">Updating…</span>}
              </span>
              <div className="flex items-center gap-2">
                <span>Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
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

      <BulkMessageDialog
        open={composing}
        onOpenChange={setComposing}
        onSent={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}
