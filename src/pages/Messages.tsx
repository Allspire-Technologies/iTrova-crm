import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Search, Send } from "lucide-react";
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMessageLog({ search: debouncedSearch, status: status || null })
      .then((r) => {
        if (cancelled) return;
        setRows(r);
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
  }, [debouncedSearch, status, reloadKey]);

  const subtitle = useMemo(() => {
    if (!rows) return "Every customer email sent from the CRM.";
    const n = rows.length;
    return `${n}${n === 500 ? "+" : ""} ${n === 1 ? "message" : "messages"}${search || status ? " match your filters" : ""}`;
  }, [rows, search, status]);

  if (error && !rows) {
    return (
      <>
        <PageHeader title="Messages" subtitle="Every customer email sent from the CRM." />
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </>
    );
  }

  const sendButton = canSend ? (
    <Button onClick={() => setComposing(true)}><Send className="size-4" /> Send message</Button>
  ) : undefined;

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

        {!rows ? (
          <LoadingState label="Loading messages…" />
        ) : rows.length === 0 ? (
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

            {loading && <p className="text-sm text-muted-foreground">Updating…</p>}
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
