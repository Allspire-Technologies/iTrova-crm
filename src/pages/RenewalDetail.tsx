import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Building2, Plus, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubscriptionBadge, PlanBadge } from "@/components/SubscriptionBadge";
import { getBusinessAggregate, type BusinessAggregate } from "@/lib/admin";
import { renewalPayments, type CsRenewalPayment } from "@/lib/cs";
import { useAuth } from "@/contexts/AuthContext";
import { roleCanRecordPayments, roleSeesRevenue } from "@/lib/roles";
import { formatDate, formatMoney } from "@/lib/format";

const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback;

type FormState = { paid_at: string; amount: string; ref_no: string; notes: string };
const emptyForm = (): FormState => ({ paid_at: new Date().toISOString().slice(0, 10), amount: "", ref_no: "", notes: "" });

const textareaClass =
  "min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Per-customer renewal payment records: payment date, optional amount, Ref No and notes.
 * All staff who can see the business may read; recording/editing is Management/Admin-only.
 */
export default function RenewalDetail() {
  const { id } = useParams();
  const role = useAuth().role;
  const canRecord = roleCanRecordPayments(role);
  const seesRevenue = roleSeesRevenue(role);

  const [business, setBusiness] = useState<BusinessAggregate | null | undefined>(undefined);
  const [records, setRecords] = useState<CsRenewalPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Add/edit form. editingId === null → collapsed; "" → new record; uuid → editing that record.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<CsRenewalPayment | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setBusiness(undefined);
    setRecords(null);
    setError(null);
    Promise.all([getBusinessAggregate(id), renewalPayments.list(id)])
      .then(([b, r]) => {
        if (cancelled) return;
        setBusiness(b);
        setRecords(r);
      })
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load this customer's renewals."));
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  function openForm(rec: CsRenewalPayment | null) {
    setEditingId(rec ? rec.id : "");
    setForm(
      rec
        ? { paid_at: rec.paid_at, amount: rec.amount == null ? "" : String(rec.amount), ref_no: rec.ref_no ?? "", notes: rec.notes ?? "" }
        : emptyForm(),
    );
  }

  async function save() {
    if (!id || !form.paid_at) return;
    setSaving(true);
    const payload = {
      paid_at: form.paid_at,
      amount: form.amount.trim() === "" ? null : Number(form.amount),
      ref_no: form.ref_no.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editingId) {
        const updated = await renewalPayments.update(editingId, payload);
        setRecords((l) => (l ?? []).map((x) => (x.id === editingId ? updated : x)));
        toast.success("Payment record updated.");
      } else {
        const created = await renewalPayments.create({
          business_id: id,
          ...payload,
          currency: business?.currency ?? "NGN",
          plan_key: business?.planKey ?? null,
          cycle: business?.subscriptionCycle ?? null,
        });
        setRecords((l) => [created, ...(l ?? [])]);
        toast.success("Payment recorded.");
      }
      setEditingId(null);
    } catch (e) {
      toast.error(errMsg(e, "Couldn't save the payment record."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await renewalPayments.remove(removing.id);
      setRecords((l) => (l ?? []).filter((x) => x.id !== removing.id));
      toast.success("Payment record removed.");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't remove the record."));
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  }

  const back = (
    <Button variant="outline" size="sm" asChild>
      <Link to="/renewals"><ArrowLeft className="size-4" /> Back to renewals</Link>
    </Button>
  );

  if (error) {
    return (
      <>
        <PageHeader title="Renewals" action={back} />
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </>
    );
  }
  if (business === undefined) {
    return (
      <>
        <PageHeader title="Renewals" action={back} />
        <LoadingState label="Loading renewals…" />
      </>
    );
  }
  if (business === null) {
    return (
      <>
        <PageHeader title="Renewals" action={back} />
        <EmptyState icon={Building2} title="Customer not found" description="This business does not exist or is no longer accessible." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={business.name}
        subtitle="Renewal payment records — reference numbers and notes for each payment."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {back}
            <Button variant="outline" size="sm" asChild>
              <Link to={`/customers/${business.businessId}`}><Building2 className="size-4" /> Customer profile</Link>
            </Button>
          </div>
        }
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => { if (!o && !removeBusy) setRemoving(null); }}
        title={`Remove this payment record${removing?.ref_no ? ` (${removing.ref_no})` : ""}?`}
        description="This permanently deletes the record. This can't be undone."
        confirmLabel="Remove record"
        variant="danger"
        busy={removeBusy}
        onConfirm={confirmRemove}
      />

      <div className="space-y-6">
        {/* Subscription context */}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Subscription</CardTitle>
            <SubscriptionBadge status={business.subscriptionStatus} />
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Plan</dt>
                <dd className="mt-0.5"><PlanBadge planKey={business.planKey} /></dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Cycle</dt>
                <dd className="mt-0.5 text-sm font-medium capitalize text-brand-dark">{business.subscriptionCycle ?? "—"}</dd>
              </div>
              {seesRevenue && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Amount</dt>
                  <dd className="mt-0.5 text-sm font-medium text-brand-dark">
                    {business.subscriptionAmount != null ? formatMoney(business.subscriptionAmount, business.currency) : "—"}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Renewal date</dt>
                <dd className="mt-0.5 text-sm font-medium text-brand-dark">{formatDate(business.renewalDate)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Records */}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2"><Receipt className="size-4" /> Payment records</CardTitle>
            {canRecord && editingId === null && (
              <Button size="sm" variant="outline" onClick={() => openForm(null)}>
                <Plus className="size-4" /> Record payment
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {canRecord && editingId !== null && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-secondary/30 p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Payment date</span>
                    <Input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} aria-label="Payment date" className="mt-1" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Amount ({business.currency}) — optional</span>
                    <Input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" aria-label="Payment amount" className="mt-1" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Ref No</span>
                    <Input value={form.ref_no} onChange={(e) => setForm({ ...form, ref_no: e.target.value })} placeholder="e.g. TRF/2026/00123" aria-label="Payment reference number" className="mt-1 font-mono" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Notes</span>
                  <textarea className={`${textareaClass} mt-1`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="How was it paid, who confirmed it…" aria-label="Payment notes" />
                </label>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  <Button size="sm" onClick={save} disabled={saving || !form.paid_at}>
                    {saving ? "Saving…" : editingId ? "Save changes" : "Record payment"}
                  </Button>
                </div>
              </div>
            )}

            {records === null ? (
              <LoadingState label="Loading records…" />
            ) : records.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No payments recorded yet{canRecord ? " — use “Record payment” to log the first one." : "."}
              </p>
            ) : (
              <div className="rounded-lg border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Paid</TableHead>
                      {seesRevenue && <TableHead>Amount</TableHead>}
                      <TableHead>Ref No</TableHead>
                      <TableHead>Notes</TableHead>
                      {canRecord && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((r) => (
                      <TableRow key={r.id} className="hover:bg-transparent">
                        <TableCell className="whitespace-nowrap font-medium text-brand-dark">{formatDate(r.paid_at)}</TableCell>
                        {seesRevenue && (
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {r.amount != null ? formatMoney(r.amount, r.currency) : "—"}
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-xs text-foreground">{r.ref_no ?? "—"}</TableCell>
                        <TableCell className="max-w-[320px] whitespace-pre-wrap text-sm text-muted-foreground">{r.notes ?? "—"}</TableCell>
                        {canRecord && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => openForm(r)} aria-label={`Edit payment ${r.ref_no ?? formatDate(r.paid_at)}`}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setRemoving(r)}
                                aria-label={`Remove payment ${r.ref_no ?? formatDate(r.paid_at)}`}
                              >
                                <Trash2 className="size-3.5" /> Remove
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
