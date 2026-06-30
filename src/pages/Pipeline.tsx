import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Check, GripVertical, Pencil, Pin, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HealthBadge } from "@/components/HealthBadge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getPipelineBoard, type PipelineCard } from "@/lib/admin";
import { pipeline, leads, type CsLead, type CsLeadUpdate, type PipelineStage } from "@/lib/cs";
import { useAuth } from "@/contexts/AuthContext";
import { roleCanWrite } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// 'lead' is intentionally NOT here: the Lead column is a standalone prospect list (cs_lead),
// decoupled from businesses. The other 7 stages are auto-derived from real businesses, so a
// business can never be dragged into Lead (which used to freeze its onboarding auto-tracking).
const BUSINESS_STAGES: { key: Exclude<PipelineStage, "lead">; label: string }[] = [
  { key: "registered", label: "Registered" },
  { key: "subscribed", label: "Subscribed" },
  { key: "onboarding", label: "Onboarding" },
  { key: "active", label: "Active" },
  { key: "power_user", label: "Power User" },
  { key: "renewed", label: "Renewed" },
  { key: "churned", label: "Churned" },
];

const EMPTY_FORM = { name: "", contact_name: "", contact_email: "", contact_phone: "", source: "", notes: "" };

function FormField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const columnClass = "flex w-72 shrink-0 flex-col rounded-xl border bg-secondary/30";

export default function Pipeline() {
  const navigate = useNavigate();
  const canMove = roleCanWrite(useAuth().role, "pipeline"); // CSO/Admin may move stages + manage leads (§3)
  const [cards, setCards] = useState<PipelineCard[] | null>(null);
  const [leadList, setLeadList] = useState<CsLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);

  // Add-lead form (all fields optional).
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Inline edit of an existing lead (same fields as the add form). `editRevert` un-converts a
  // converted lead back to "open" on save (the toggle is only shown for converted leads).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editRevert, setEditRevert] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Confirmations for the lead actions that change/remove a card.
  const [convertingLead, setConvertingLead] = useState<CsLead | null>(null);
  const [converting, setConverting] = useState(false);
  const [removingLead, setRemovingLead] = useState<CsLead | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCards(null);
    setLeadList(null);
    setError(null);
    // Open AND converted leads stay in the Lead column; a card only leaves when it's deleted.
    Promise.all([getPipelineBoard(), leads.list("all")])
      .then(([c, l]) => {
        if (cancelled) return;
        setCards(c);
        setLeadList(l);
      })
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load the pipeline."));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const byStage = useMemo(() => {
    const groups = new Map<string, PipelineCard[]>(BUSINESS_STAGES.map((s) => [s.key, []]));
    for (const c of cards ?? []) groups.get(c.stage)?.push(c);
    return groups;
  }, [cards]);

  async function move(businessId: string, to: PipelineStage) {
    if (to === "lead") return; // businesses can't enter the standalone Lead column
    const card = cards?.find((c) => c.businessId === businessId);
    if (!card || card.stage === to) return;
    const prev = cards ?? [];
    setCards((cs) => (cs ?? []).map((c) => (c.businessId === businessId ? { ...c, stage: to, stageSource: "manual" } : c)));
    try {
      await pipeline.set(businessId, to, "manual");
      toast.success(`Moved ${card.name} to ${BUSINESS_STAGES.find((s) => s.key === to)?.label}.`);
    } catch (e) {
      setCards(prev);
      toast.error((e as { message?: string })?.message ?? "Couldn't move this business.");
    }
  }

  async function addLead(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      source: form.source.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      const created = await leads.create(payload);
      setLeadList((l) => [created, ...(l ?? [])]);
      setForm(EMPTY_FORM);
      setAddOpen(false);
      toast.success("Lead added.");
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "Couldn't add the lead.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(lead: CsLead) {
    setEditingId(lead.id);
    setEditRevert(false);
    setEditForm({
      name: lead.name ?? "",
      contact_name: lead.contact_name ?? "",
      contact_email: lead.contact_email ?? "",
      contact_phone: lead.contact_phone ?? "",
      source: lead.source ?? "",
      notes: lead.notes ?? "",
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const id = editingId;
    const lead = (leadList ?? []).find((x) => x.id === id);
    setSavingEdit(true);
    const payload: CsLeadUpdate = {
      name: editForm.name.trim() || null,
      contact_name: editForm.contact_name.trim() || null,
      contact_email: editForm.contact_email.trim() || null,
      contact_phone: editForm.contact_phone.trim() || null,
      source: editForm.source.trim() || null,
      notes: editForm.notes.trim() || null,
    };
    // Un-convert: only meaningful (and only offered) for a currently-converted lead.
    if (lead?.status === "converted" && editRevert) payload.status = "open";
    try {
      const updated = await leads.update(id, payload);
      setLeadList((l) => (l ?? []).map((x) => (x.id === id ? updated : x)));
      setEditingId(null);
      toast.success("Lead updated.");
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "Couldn't update the lead.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Convert (after confirming) marks the lead converted but keeps it in the column (status badge
  // flips); it only leaves when explicitly removed. To undo, edit the lead and toggle revert.
  async function confirmConvert() {
    const lead = convertingLead;
    if (!lead) return;
    setConverting(true);
    const prev = leadList ?? [];
    setLeadList((l) => (l ?? []).map((x) => (x.id === lead.id ? { ...x, status: "converted" } : x)));
    try {
      const updated = await leads.update(lead.id, { status: "converted" });
      setLeadList((l) => (l ?? []).map((x) => (x.id === lead.id ? updated : x)));
      toast.success(`Marked ${lead.name ?? "lead"} as converted.`);
    } catch (e) {
      setLeadList(prev);
      toast.error((e as { message?: string })?.message ?? "Couldn't convert the lead.");
    } finally {
      setConverting(false);
      setConvertingLead(null);
    }
  }

  async function confirmRemove() {
    const lead = removingLead;
    if (!lead) return;
    setRemoving(true);
    const prev = leadList ?? [];
    setLeadList((l) => (l ?? []).filter((x) => x.id !== lead.id));
    try {
      await leads.remove(lead.id);
      toast.success(`Removed ${lead.name ?? "lead"}.`);
    } catch (e) {
      setLeadList(prev);
      toast.error((e as { message?: string })?.message ?? "Couldn't remove the lead.");
    } finally {
      setRemoving(false);
      setRemovingLead(null);
    }
  }

  const inputs: { key: keyof typeof EMPTY_FORM; label: string; placeholder: string; type?: string }[] = [
    { key: "name", label: "Name", placeholder: "Prospect or business name" },
    { key: "contact_name", label: "Contact name", placeholder: "Person" },
    { key: "source", label: "Source", placeholder: "Referral, event…" },
    { key: "contact_email", label: "Email", placeholder: "name@example.com", type: "email" },
    { key: "contact_phone", label: "Phone", placeholder: "+234…" },
  ];

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={
          canMove
            ? "Leads are standalone prospects. The other stages auto-update nightly — drag a card to pin it."
            : "Leads are standalone prospects. The other stages auto-update nightly."
        }
        action={
          <div className="flex items-center gap-2">
            {canMove && (
              <Button variant="outline" size="sm" onClick={() => setAddOpen((o) => !o)}>
                <Plus /> Add lead
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw /> Refresh
            </Button>
          </div>
        }
      />

      {addOpen && canMove && (
        <form onSubmit={addLead} className="mb-4 rounded-xl border border-border/60 bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-brand-dark">New lead</h2>
            <span className="text-xs text-muted-foreground">All fields optional</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inputs.map((f) => (
              <FormField key={f.key} label={f.label}>
                <Input
                  type={f.type ?? "text"}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  aria-label={`Lead ${f.label.toLowerCase()}`}
                />
              </FormField>
            ))}
            <FormField label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Context…"
                aria-label="Lead notes"
                rows={1}
                className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </FormField>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setForm(EMPTY_FORM); setAddOpen(false); }}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save lead"}
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={convertingLead !== null}
        onOpenChange={(o) => { if (!o && !converting) setConvertingLead(null); }}
        title={`Convert ${convertingLead?.name?.trim() || "this lead"}?`}
        description="Marks the lead as converted. The card stays in the Lead column with a Converted badge — you can revert it later by editing the lead."
        confirmLabel="Mark converted"
        busy={converting}
        onConfirm={confirmConvert}
      />

      <ConfirmDialog
        open={removingLead !== null}
        onOpenChange={(o) => { if (!o && !removing) setRemovingLead(null); }}
        title={`Remove ${removingLead?.name?.trim() || "this lead"}?`}
        description="This permanently deletes the lead and its details. This can't be undone."
        confirmLabel="Remove lead"
        variant="danger"
        busy={removing}
        onConfirm={confirmRemove}
      />

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : cards === null || leadList === null ? (
        <LoadingState label="Loading pipeline…" />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {/* Lead column — standalone prospects (cs_lead). Not a business drop target. */}
          <div className={cn(columnClass, "border-border/60")}>
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
              <span className="text-sm font-semibold text-brand-dark">Lead</span>
              <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">{leadList.length}</span>
            </div>
            <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
              {leadList.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {canMove ? "No leads yet. Use “Add lead” to track a prospect." : "No leads yet."}
                </p>
              ) : (
                leadList.map((lead) =>
                  canMove && editingId === lead.id ? (
                    <form key={lead.id} onSubmit={saveEdit} className="space-y-2 rounded-lg border border-brand/40 bg-card p-3 shadow-sm">
                      {inputs.map((f) => (
                        <FormField key={f.key} label={f.label}>
                          <Input
                            type={f.type ?? "text"}
                            value={editForm[f.key]}
                            onChange={(e) => setEditForm({ ...editForm, [f.key]: e.target.value })}
                            placeholder={f.placeholder}
                            aria-label={`Edit lead ${f.label.toLowerCase()}`}
                          />
                        </FormField>
                      ))}
                      <FormField label="Notes">
                        <textarea
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                          placeholder="Context…"
                          aria-label="Edit lead notes"
                          rows={2}
                          className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </FormField>
                      {lead.status === "converted" && (
                        <label className="flex items-center gap-2 rounded-md bg-secondary/40 px-2 py-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={editRevert}
                            onChange={(e) => setEditRevert(e.target.checked)}
                            aria-label="Revert to open lead"
                            className="size-3.5 accent-brand"
                          />
                          Revert to open lead (un-convert)
                        </label>
                      )}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                        <Button type="submit" variant="brand" size="sm" className="h-7 px-2 text-xs" disabled={savingEdit}>
                          {savingEdit ? "Saving…" : "Save"}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div key={lead.id} className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-brand-dark">{lead.name?.trim() || "Untitled lead"}</span>
                        {lead.status === "converted" && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                            <Check className="size-3" /> Converted
                          </span>
                        )}
                      </div>
                      {(lead.contact_name || lead.contact_email || lead.contact_phone) && (
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {lead.contact_name && <div className="truncate">{lead.contact_name}</div>}
                          {lead.contact_email && <div className="truncate">{lead.contact_email}</div>}
                          {lead.contact_phone && <div className="truncate">{lead.contact_phone}</div>}
                        </div>
                      )}
                      {lead.source && (
                        <span className="mt-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{lead.source}</span>
                      )}
                      {lead.notes && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{lead.notes}</p>}
                      {canMove && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                          {lead.status !== "converted" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => setConvertingLead(lead)}
                              aria-label={`Convert ${lead.name ?? "lead"}`}
                              title="Mark as converted — the card stays here until you remove it"
                            >
                              <Check className="size-3" /> Convert
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                            onClick={() => startEdit(lead)}
                            aria-label={`Edit ${lead.name ?? "lead"}`}
                          >
                            <Pencil className="size-3" /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setRemovingLead(lead)}
                            aria-label={`Remove ${lead.name ?? "lead"}`}
                          >
                            <Trash2 className="size-3" /> Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  ),
                )
              )}
            </div>
          </div>

          {/* Business stages — auto-derived nightly; drag a card to pin it. */}
          {BUSINESS_STAGES.map((s) => {
            const items = byStage.get(s.key) ?? [];
            return (
              <div
                key={s.key}
                className={cn(columnClass, "transition-colors", overStage === s.key ? "border-brand/50 bg-brand-light/30" : "border-border/60")}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overStage !== s.key) setOverStage(s.key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((cur) => (cur === s.key ? null : cur));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  setOverStage(null);
                  setDragId(null);
                  if (id) move(id, s.key);
                }}
              >
                <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
                  <span className="text-sm font-semibold text-brand-dark">{s.label}</span>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">{items.length}</span>
                </div>

                <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
                  {items.map((c) => (
                    <div
                      key={c.businessId}
                      draggable={canMove}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", c.businessId);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(c.businessId);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      onClick={() => navigate(`/customers/${c.businessId}`)}
                      className={cn(
                        "group cursor-pointer rounded-lg border border-border/60 bg-card p-3 shadow-sm transition-all hover:border-brand/40 hover:shadow",
                        dragId === c.businessId && "opacity-50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-brand-dark">{c.name}</span>
                        {canMove && <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/50 group-hover:text-muted-foreground" />}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <HealthBadge band={c.healthBand} score={c.healthScore} />
                        {c.stageSource === "manual" && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Pinned manually — the nightly job won't move it">
                            <Pin className="size-3" /> Manual
                          </span>
                        )}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <div className="truncate">{c.accountManagerName ?? "Unassigned"}</div>
                        {c.renewalDate && (
                          <div className="flex items-center gap-1">
                            <CalendarClock className="size-3" /> Renews {formatDate(c.renewalDate)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
