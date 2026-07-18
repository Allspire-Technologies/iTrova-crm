import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate, formatRelative } from "@/lib/format";
import {
  notes,
  tickets,
  featureRequests,
  feedback,
  tasks,
  type CsNote,
  type CsTicket,
  type CsFeatureRequest,
  type CsFeedback,
  type CsTask,
  type NoteType,
  type TicketPriority,
  type TicketStatus,
  type FeatureRequestStatus,
  type TaskStatus,
  type TaskType,
  type TaskRole,
} from "@/lib/cs";
import { ROLE_LABELS } from "@/lib/tasks";
import {
  listTemplates,
  listCustomerMessages,
  sendCustomerEmail,
  logWhatsapp,
  renderTemplate,
  richTextIsEmpty,
  htmlToPlainText,
  type EmailTemplate,
  type CustomerMessage,
  type MergeVars,
} from "@/lib/messaging";
import { customerWaNumber, isValidWaNumber, waLink } from "@/lib/whatsapp";
// Static import is fine: CrmTabs is itself a lazy chunk, so TipTap stays out of the main bundle.
import RichTextEditor from "@/components/RichTextEditor";
import { useAuth } from "@/contexts/AuthContext";
import { roleCanWrite, roleCanMessageCustomers } from "@/lib/roles";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const textareaClass =
  "min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function msg(e: unknown) {
  return (e as { message?: string })?.message ?? "Something went wrong.";
}

function Row({ children }: { children: ReactNode }) {
  return <li className="rounded-lg border border-border/60 bg-card px-4 py-3">{children}</li>;
}

function Empty({ label }: { label: string }) {
  return <li className="rounded-lg border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">{label}</li>;
}

// --------------------------------------------------------------------------- Notes
function NotesTab({ businessId }: { businessId: string }) {
  const canWrite = roleCanWrite(useAuth().role, "notes");
  const [list, setList] = useState<CsNote[] | null>(null);
  const [type, setType] = useState<NoteType>("general");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  useEffect(() => {
    notes.list({ businessId }).then(setList).catch((e) => toast.error(msg(e)));
  }, [businessId]);

  async function add() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const created = await notes.create({ business_id: businessId, type, body: body.trim() });
      setList((l) => [created, ...(l ?? [])]);
      setBody("");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string) {
    try {
      const updated = await notes.update(id, { body: editBody.trim() });
      setList((l) => (l ?? []).map((n) => (n.id === id ? updated : n)));
      setEditing(null);
    } catch (e) {
      toast.error(msg(e));
    }
  }

  return (
    <div className="space-y-4">
      {canWrite && (
      <div className="space-y-2 rounded-lg border border-border/60 bg-secondary/30 p-3">
        <div className="flex items-center gap-2">
          <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as NoteType)} aria-label="Note type">
            <option value="general">General</option>
            <option value="meeting">Meeting</option>
            <option value="call">Call</option>
          </select>
          <span className="text-xs text-muted-foreground">New note</span>
        </div>
        <textarea className={textareaClass} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a note…" aria-label="Note body" />
        <Button size="sm" onClick={add} disabled={saving || !body.trim()}>Add note</Button>
      </div>
      )}

      <ul className="space-y-2">
        {list == null && <Empty label="Loading…" />}
        {list?.length === 0 && <Empty label="No notes yet." />}
        {list?.map((n) => (
          <Row key={n.id}>
            <div className="flex items-center justify-between gap-2">
              <Badge variant="secondary" className="capitalize">{n.type}</Badge>
              <span className="text-xs text-muted-foreground">{formatRelative(n.created_at)}</span>
            </div>
            {editing === n.id ? (
              <div className="mt-2 space-y-2">
                <textarea className={textareaClass} value={editBody} onChange={(e) => setEditBody(e.target.value)} aria-label="Edit note" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveEdit(n.id)} disabled={!editBody.trim()}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="mt-1.5 flex items-start justify-between gap-3">
                <p className="whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                {canWrite && <Button size="sm" variant="ghost" onClick={() => { setEditing(n.id); setEditBody(n.body); }}>Edit</Button>}
              </div>
            )}
          </Row>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- Tickets
function TicketsTab({ businessId }: { businessId: string }) {
  const canWrite = roleCanWrite(useAuth().role, "tickets");
  const [list, setList] = useState<CsTicket[] | null>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("med");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    tickets.list({ businessId }).then(setList).catch((e) => toast.error(msg(e)));
  }, [businessId]);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const created = await tickets.create({ business_id: businessId, title: title.trim(), priority });
      setList((l) => [created, ...(l ?? [])]);
      setTitle("");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, patch: Parameters<typeof tickets.update>[1]) {
    try {
      const updated = await tickets.update(id, patch);
      setList((l) => (l ?? []).map((t) => (t.id === id ? updated : t)));
    } catch (e) {
      toast.error(msg(e));
    }
  }

  return (
    <div className="space-y-4">
      {canWrite && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-secondary/30 p-3">
        <Input className="min-w-[200px] flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New ticket title…" aria-label="Ticket title" />
        <select className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} aria-label="Ticket priority">
          <option value="low">Low</option>
          <option value="med">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <Button size="sm" onClick={add} disabled={saving || !title.trim()}>Add ticket</Button>
      </div>
      )}

      <ul className="space-y-2">
        {list == null && <Empty label="Loading…" />}
        {list?.length === 0 && <Empty label="No tickets yet." />}
        {list?.map((t) => (
          <Row key={t.id}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-[10rem] flex-1 font-medium text-brand-dark">{t.title}</span>
              <select
                className={selectClass}
                disabled={!canWrite}
                value={t.priority}
                onChange={(e) => patch(t.id, { priority: e.target.value as TicketPriority })}
                aria-label={`Priority for ${t.title}`}
              >
                <option value="low">Low</option>
                <option value="med">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <select
                className={selectClass}
                disabled={!canWrite}
                value={t.status}
                onChange={(e) => {
                  const status = e.target.value as TicketStatus;
                  patch(t.id, { status, resolved_at: status === "resolved" ? new Date().toISOString() : null });
                }}
                aria-label={`Status for ${t.title}`}
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </Row>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- Feature requests
function FeaturesTab({ businessId }: { businessId: string }) {
  const canWrite = roleCanWrite(useAuth().role, "features");
  const [list, setList] = useState<CsFeatureRequest[] | null>(null);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    featureRequests.list({ businessId }).then(setList).catch((e) => toast.error(msg(e)));
  }, [businessId]);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const created = await featureRequests.create({ business_id: businessId, title: title.trim(), detail: detail.trim() || null });
      setList((l) => [created, ...(l ?? [])]);
      setTitle("");
      setDetail("");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: FeatureRequestStatus) {
    try {
      const updated = await featureRequests.update(id, { status });
      setList((l) => (l ?? []).map((f) => (f.id === id ? updated : f)));
    } catch (e) {
      toast.error(msg(e));
    }
  }

  return (
    <div className="space-y-4">
      {canWrite && (
      <div className="space-y-2 rounded-lg border border-border/60 bg-secondary/30 p-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Feature request title…" aria-label="Feature title" />
        <textarea className={textareaClass} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Detail (optional)…" aria-label="Feature detail" />
        <Button size="sm" onClick={add} disabled={saving || !title.trim()}>Add request</Button>
      </div>
      )}

      <ul className="space-y-2">
        {list == null && <Empty label="Loading…" />}
        {list?.length === 0 && <Empty label="No feature requests yet." />}
        {list?.map((f) => (
          <Row key={f.id}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-[10rem] flex-1 font-medium text-brand-dark">{f.title}</span>
              <Badge variant="outline">{f.votes} votes</Badge>
              <select className={selectClass} disabled={!canWrite} value={f.status} onChange={(e) => setStatus(f.id, e.target.value as FeatureRequestStatus)} aria-label={`Status for ${f.title}`}>
                <option value="new">New</option>
                <option value="planned">Planned</option>
                <option value="shipped">Shipped</option>
                <option value="declined">Declined</option>
              </select>
            </div>
            {f.detail && <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">{f.detail}</p>}
          </Row>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- Feedback
function FeedbackTab({ businessId }: { businessId: string }) {
  const canWrite = roleCanWrite(useAuth().role, "feedback");
  const [list, setList] = useState<CsFeedback[] | null>(null);
  const [rating, setRating] = useState("5");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    feedback.list({ businessId }).then(setList).catch((e) => toast.error(msg(e)));
  }, [businessId]);

  async function add() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const created = await feedback.create({ business_id: businessId, rating: Number(rating), body: body.trim() });
      setList((l) => [created, ...(l ?? [])]);
      setBody("");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {canWrite && (
      <div className="space-y-2 rounded-lg border border-border/60 bg-secondary/30 p-3">
        <div className="flex items-center gap-2">
          <select className={selectClass} value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Rating">
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{n} ★</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">Customer feedback</span>
        </div>
        <textarea className={textareaClass} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did the customer say?" aria-label="Feedback body" />
        <Button size="sm" onClick={add} disabled={saving || !body.trim()}>Add feedback</Button>
      </div>
      )}

      <ul className="space-y-2">
        {list == null && <Empty label="Loading…" />}
        {list?.length === 0 && <Empty label="No feedback yet." />}
        {list?.map((f) => (
          <Row key={f.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-amber-600">{"★".repeat(f.rating ?? 0)}<span className="text-border">{"★".repeat(5 - (f.rating ?? 0))}</span></span>
              <span className="text-xs text-muted-foreground">{formatRelative(f.created_at)}</span>
            </div>
            {f.body && <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{f.body}</p>}
          </Row>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- Tasks
function TasksTab({ businessId }: { businessId: string }) {
  const canWrite = roleCanWrite(useAuth().role, "tasks");
  const [list, setList] = useState<CsTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("follow_up");
  const [role, setRole] = useState<TaskRole>("cso");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    tasks.list({ businessId }).then(setList).catch((e) => toast.error(msg(e)));
  }, [businessId]);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const created = await tasks.create({ business_id: businessId, title: title.trim(), type, assignee_role: role, due_date: due || null });
      setList((l) => [created, ...(l ?? [])]);
      setTitle("");
      setDue("");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: TaskStatus) {
    try {
      const updated = await tasks.update(id, { status, completed_at: status === "done" ? new Date().toISOString() : null });
      setList((l) => (l ?? []).map((t) => (t.id === id ? updated : t)));
    } catch (e) {
      toast.error(msg(e));
    }
  }

  return (
    <div className="space-y-4">
      {canWrite && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-secondary/30 p-3">
        <Input className="min-w-[180px] flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" aria-label="Task title" />
        <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as TaskType)} aria-label="Task type">
          <option value="call">Call</option>
          <option value="meeting">Meeting</option>
          <option value="follow_up">Follow up</option>
          <option value="renewal">Renewal</option>
        </select>
        <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value as TaskRole)} aria-label="Assign to">
          <option value="pm">Product Manager</option>
          <option value="cso">Customer Success Officer</option>
          <option value="support">Support Team</option>
        </select>
        <input type="date" className={selectClass} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Task due date" />
        <Button size="sm" onClick={add} disabled={saving || !title.trim()}>Add task</Button>
      </div>
      )}

      <ul className="space-y-2">
        {list == null && <Empty label="Loading…" />}
        {list?.length === 0 && <Empty label="No tasks yet." />}
        {list?.map((t) => (
          <Row key={t.id}>
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("min-w-[10rem] flex-1 font-medium", t.status === "done" ? "text-muted-foreground line-through" : "text-brand-dark")}>{t.title}</span>
              <Badge variant="secondary" className="capitalize">{t.type.replace("_", " ")}</Badge>
              {t.assignee_role && <span className="text-xs text-muted-foreground">{ROLE_LABELS[t.assignee_role]}</span>}
              {t.due_date && <span className="text-xs text-muted-foreground">Due {formatDate(t.due_date)}</span>}
              <select className={selectClass} disabled={!canWrite} value={t.status} onChange={(e) => setStatus(t.id, e.target.value as TaskStatus)} aria-label={`Status for ${t.title}`}>
                <option value="todo">To do</option>
                <option value="doing">Doing</option>
                <option value="done">Done</option>
              </select>
            </div>
          </Row>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- Messages (email + WhatsApp)
export type MessageCustomer = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  whatsappNumber: string | null;
  phone: string | null;
  planKey: string | null;
  renewalDate: string | null;
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function MessagesTab({ customer }: { customer: MessageCustomer }) {
  const canSend = roleCanMessageCustomers(useAuth().role);
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [history, setHistory] = useState<CustomerMessage[] | null>(null);
  const [templateKey, setTemplateKey] = useState(""); // "" = freeform
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");           // email: rich-text HTML
  const [waText, setWaText] = useState("");        // whatsapp: plain text
  const [sending, setSending] = useState(false);

  const vars: MergeVars = {
    business_name: customer.name,
    owner_name: customer.ownerName ?? "there",
    plan: cap(customer.planKey ?? "—"),
    renewal_date: customer.renewalDate ? formatDate(customer.renewalDate) : "—",
  };
  const waNumber = customerWaNumber(customer.whatsappNumber, customer.phone);
  const hasWaNumber = isValidWaNumber(customer.whatsappNumber) || isValidWaNumber(customer.phone);

  useEffect(() => {
    if (canSend) listTemplates().then(setTemplates).catch((e) => toast.error(msg(e)));
  }, [canSend]);
  useEffect(() => {
    listCustomerMessages(customer.id).then(setHistory).catch((e) => toast.error(msg(e)));
  }, [customer.id]);

  // Re-apply the picked template when switching channel, since email carries HTML + subject and
  // WhatsApp is plain text with no subject.
  function pickTemplate(key: string) {
    setTemplateKey(key);
    const t = templates.find((x) => x.key === key);
    setSubject(t ? renderTemplate(t.subject, vars) : "");
    setBody(t ? renderTemplate(t.body, vars) : "");
    setWaText(t ? htmlToPlainText(renderTemplate(t.body, vars)) : "");
  }

  async function sendEmail() {
    if (!customer.ownerEmail || !subject.trim() || richTextIsEmpty(body)) return;
    setSending(true);
    try {
      const sentTo = await sendCustomerEmail({ businessId: customer.id, subject: subject.trim(), html: body, templateKey: templateKey || null });
      toast.success(`Email sent to ${sentTo || customer.ownerEmail}.`);
      setSubject(""); setBody(""); setTemplateKey("");
      listCustomerMessages(customer.id).then(setHistory).catch(() => {});
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setSending(false);
    }
  }

  async function sendWhatsapp() {
    if (!hasWaNumber || !waText.trim()) return;
    // Open WhatsApp with the number + text; the staff member taps Send. Then log it (best-effort).
    window.open(waLink(waNumber, waText.trim()), "_blank", "noopener,noreferrer");
    try {
      await logWhatsapp({ businessId: customer.id, toPhone: waNumber, toName: customer.ownerName, body: waText.trim(), templateKey: templateKey || null });
      toast.success("Opened WhatsApp — send the message there.");
      setWaText(""); setTemplateKey("");
      listCustomerMessages(customer.id).then(setHistory).catch(() => {});
    } catch (e) {
      toast.error(msg(e)); // the link still opened; only the log failed
    }
  }

  return (
    <div className="space-y-4">
      {canSend ? (
        <div className="space-y-2 rounded-lg border border-border/60 bg-secondary/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Channel toggle */}
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              <button type="button" onClick={() => setChannel("email")}
                className={cn("px-3 py-1 text-xs font-medium", channel === "email" ? "bg-brand text-white" : "bg-background text-muted-foreground hover:text-foreground")}>
                Email
              </button>
              <button type="button" onClick={() => setChannel("whatsapp")}
                className={cn("px-3 py-1 text-xs font-medium", channel === "whatsapp" ? "bg-brand text-white" : "bg-background text-muted-foreground hover:text-foreground")}>
                WhatsApp
              </button>
            </div>
            <select className={selectClass} value={templateKey} onChange={(e) => pickTemplate(e.target.value)} aria-label="Message template">
              <option value="">Freeform</option>
              {templates.map((t) => (<option key={t.key} value={t.key}>{t.name}</option>))}
            </select>
            <span className="text-xs text-muted-foreground">
              {channel === "email"
                ? `To: ${customer.ownerEmail ?? "— no owner email on file"}`
                : `To: ${hasWaNumber ? `+${waNumber}` : "— no WhatsApp/phone number on file"}`}
            </span>
          </div>

          {channel === "email" ? (
            <>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Email subject" />
              <RichTextEditor value={body} onChange={setBody} placeholder="Write your message…" ariaLabel="Email body" className="bg-background" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">One-way — replies aren’t monitored.</span>
                <Button size="sm" onClick={sendEmail} disabled={sending || !customer.ownerEmail || !subject.trim() || richTextIsEmpty(body)}>
                  {sending ? "Sending…" : "Send email"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <textarea
                value={waText} onChange={(e) => setWaText(e.target.value)} rows={5}
                placeholder="Write your WhatsApp message…" aria-label="WhatsApp message"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Opens WhatsApp with your message — send it there.</span>
                <Button size="sm" onClick={sendWhatsapp} disabled={!hasWaNumber || !waText.trim()}>Send on WhatsApp</Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <Empty label="Only Management/Admin and Support can message customers." />
      )}

      <ul className="space-y-2">
        {history == null && <Empty label="Loading…" />}
        {history?.length === 0 && <Empty label="No messages sent yet." />}
        {history?.map((m) => (
          <Row key={m.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-brand-dark">
                {m.channel === "whatsapp" ? (m.subject ?? "WhatsApp message") : m.subject}
              </span>
              <Badge variant="outline" className="shrink-0">{m.channel === "whatsapp" ? "WhatsApp" : "Email"}</Badge>
              <Badge variant={m.status === "failed" ? "destructive" : "secondary"}>{m.status}</Badge>
              <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(m.createdAt)}</span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              To {m.channel === "whatsapp" ? (m.toPhone ? `+${m.toPhone}` : "—") : m.toEmail}
              {m.templateKey ? ` · ${m.templateKey}` : ""}{m.sentByName ? ` · by ${m.sentByName}` : ""}
            </div>
            {m.error && <div className="mt-1 text-xs text-destructive">{m.error}</div>}
          </Row>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- Tabs shell
const TABS = [
  { key: "notes", label: "Meeting Notes" },
  { key: "tickets", label: "Support Tickets" },
  { key: "features", label: "Feature Requests" },
  { key: "feedback", label: "Customer Feedback" },
  { key: "tasks", label: "Tasks" },
  { key: "messages", label: "Messages" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function CrmTabs({ businessId, customer }: { businessId: string; customer: MessageCustomer }) {
  const [tab, setTab] = useState<TabKey>("notes");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border/60">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-brand text-brand-dark"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "notes" && <NotesTab businessId={businessId} />}
      {tab === "tickets" && <TicketsTab businessId={businessId} />}
      {tab === "features" && <FeaturesTab businessId={businessId} />}
      {tab === "feedback" && <FeedbackTab businessId={businessId} />}
      {tab === "tasks" && <TasksTab businessId={businessId} />}
      {tab === "messages" && <MessagesTab customer={customer} />}
    </div>
  );
}
