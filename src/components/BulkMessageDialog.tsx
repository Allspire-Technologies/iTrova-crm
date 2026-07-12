import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RichTextEditor from "@/components/RichTextEditor";
import { listCustomersPage } from "@/lib/customers";
import { formatDate } from "@/lib/format";
import {
  listTemplates,
  sendCustomerEmail,
  renderTemplate,
  richTextIsEmpty,
  type EmailTemplate,
  type MergeVars,
} from "@/lib/messaging";

/** A customer that can receive a message — just enough to resolve merge fields + identify the send. */
export type MessageRecipient = {
  businessId: string;
  name: string;
  ownerName: string | null;
  planKey: string | null;
  renewalDate: string | null;
};

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function varsFor(c: MessageRecipient): MergeVars {
  return {
    business_name: c.name,
    owner_name: c.ownerName ?? "there",
    plan: cap(c.planKey ?? "—"),
    renewal_date: c.renewalDate ? formatDate(c.renewalDate) : "—",
  };
}

/** Compose one message and send it to many customers. Each recipient's email is rendered with THEIR
 *  own merge fields (so {{owner_name}} etc. personalise), sent one-by-one through the same Edge
 *  Function as the single-customer composer, and logged like any other send. */
export function BulkMessageDialog({
  open,
  onOpenChange,
  initialRecipients,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialRecipients?: MessageRecipient[];
  onSent?: () => void;
}) {
  const [recipients, setRecipients] = useState<MessageRecipient[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<MessageRecipient[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRecipients(initialRecipients ?? []);
    setTemplateKey("");
    setSubject("");
    setBody("");
    setProgress(null);
    setPickerQuery("");
    setPickerResults([]);
    setPickerOpen(false);
    listTemplates().then(setTemplates).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sending) onOpenChange(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced customer search for the recipient picker (scoped by RLS like the Customers list).
  useEffect(() => {
    if (!open) return;
    const q = pickerQuery.trim();
    if (!q) { setPickerResults([]); return; }
    const t = setTimeout(() => {
      listCustomersPage({ search: q, sort: "name", dir: "asc", pageSize: 8 })
        .then((p) => setPickerResults(p.rows.map((r) => ({ businessId: r.businessId, name: r.name, ownerName: r.ownerName, planKey: r.planKey, renewalDate: r.renewalDate }))))
        .catch(() => setPickerResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [pickerQuery, open]);

  const chosen = useMemo(() => new Set(recipients.map((r) => r.businessId)), [recipients]);

  function pickTemplate(key: string) {
    setTemplateKey(key);
    const t = templates.find((x) => x.key === key);
    // Keep {{tokens}} unrendered — they personalise per recipient at send time.
    setSubject(t ? t.subject : "");
    setBody(t ? t.body : "");
  }

  function addRecipient(c: MessageRecipient) {
    if (chosen.has(c.businessId)) return;
    setRecipients((r) => [...r, c]);
    setPickerQuery("");
    setPickerResults([]);
    setPickerOpen(false);
  }
  function removeRecipient(id: string) {
    setRecipients((r) => r.filter((x) => x.businessId !== id));
  }

  const canSend = recipients.length > 0 && subject.trim().length > 0 && !richTextIsEmpty(body) && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setProgress({ done: 0, total: recipients.length });
    let sent = 0;
    let failed = 0;
    for (const c of recipients) {
      const vars = varsFor(c);
      try {
        await sendCustomerEmail({
          businessId: c.businessId,
          subject: renderTemplate(subject, vars).trim(),
          html: renderTemplate(body, vars),
          templateKey: templateKey || null,
        });
        sent++;
      } catch {
        failed++;
      }
      setProgress({ done: sent + failed, total: recipients.length });
    }
    setSending(false);
    if (failed === 0) toast.success(`Message sent to ${sent} customer${sent === 1 ? "" : "s"}.`);
    else toast.error(`Sent to ${sent}; ${failed} failed. See the log for details.`);
    onOpenChange(false);
    onSent?.();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !sending && onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-msg-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="bulk-msg-title" className="font-display text-lg font-semibold text-brand-dark">Send a message</h2>
          <button onClick={() => !sending && onOpenChange(false)} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* Recipients */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Recipients ({recipients.length})</label>
            <div className="flex flex-wrap gap-1.5">
              {recipients.map((c) => (
                <span key={c.businessId} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-secondary px-2.5 py-1 text-sm text-brand-dark">
                  {c.name}
                  <button onClick={() => removeRecipient(c.businessId)} aria-label={`Remove ${c.name}`} className="text-muted-foreground hover:text-destructive">
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              {recipients.length === 0 && <span className="text-sm text-muted-foreground">No recipients yet — search to add customers.</span>}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={pickerQuery}
                onChange={(e) => { setPickerQuery(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Add a customer…"
                className="pl-9"
                aria-label="Add a customer"
              />
              {pickerOpen && pickerResults.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-elevated">
                  {pickerResults.map((c) => (
                    <button
                      key={c.businessId}
                      type="button"
                      onClick={() => addRecipient(c)}
                      disabled={chosen.has(c.businessId)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary disabled:opacity-50"
                    >
                      <span className="truncate">{c.name}{c.ownerName ? <span className="text-muted-foreground"> · {c.ownerName}</span> : null}</span>
                      {chosen.has(c.businessId) && <span className="shrink-0 text-xs text-muted-foreground">added</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectClass} value={templateKey} onChange={(e) => pickTemplate(e.target.value)} aria-label="Email template">
              <option value="">Freeform</option>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">Tokens like <code>{"{{owner_name}}"}</code> fill in per customer.</span>
          </div>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Email subject" />
          <RichTextEditor value={body} onChange={setBody} placeholder="Write your message…" ariaLabel="Email body" className="bg-background" />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          <span className="text-xs text-muted-foreground">
            {sending && progress ? `Sending ${progress.done}/${progress.total}…` : "One-way — replies aren’t monitored."}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
            <Button onClick={send} disabled={!canSend}>
              <Send className="size-4" /> {sending ? "Sending…" : recipients.length ? `Send to ${recipients.length}` : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
