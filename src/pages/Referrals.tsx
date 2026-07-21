import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { roleSeesRevenue } from "@/lib/roles";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getReferralConfig, updateReferralConfig, listReferrers, saveReferrer, setReferrerActive, sendReferrerWelcome,
  listApplications, setApplicationStatus, listReferredBusinesses,
  type Referrer, type ReferrerApplication, type ReferredBusiness,
} from "@/lib/referrals";
import { rewardFor, suggestCode, type ReferralConfig, type ReferrerKind } from "@/lib/referralMath";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const KIND_LABEL: Record<ReferrerKind, string> = { affiliate: "Affiliate", staff: "Staff", business: "Business" };

const TABS = [
  { key: "referred", label: "Referred signups" },
  { key: "referrers", label: "Referrers" },
  { key: "applications", label: "Applications" },
  { key: "settings", label: "Program settings" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function Referrals() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const seesMoney = roleSeesRevenue(role);
  const [tab, setTab] = useState<TabKey>("referred");
  const [config, setConfig] = useState<ReferralConfig | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    getReferralConfig().then(setConfig).catch((e) => toast.error(msg(e)));
    listApplications().then((a) => setPending(a.filter((x) => x.status === "pending").length)).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader title="Referrals" subtitle="Track referral signups, manage referrers, and see what's owed." />
      <div className="mb-6 flex flex-wrap gap-1 border-b border-border/60">
        {TABS.map((t) => (
          <button
            key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "border-brand text-brand-dark" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}{t.key === "applications" && pending > 0 && <span className="ml-1.5 rounded-full bg-brand/15 px-1.5 text-xs text-brand">{pending}</span>}
          </button>
        ))}
      </div>

      {tab === "referred" && config && <ReferredTab config={config} seesMoney={seesMoney} />}
      {tab === "referrers" && <ReferrersTab isAdmin={isAdmin} config={config} seesMoney={seesMoney} />}
      {tab === "applications" && <ApplicationsTab isAdmin={isAdmin} onChange={() => listApplications().then((a) => setPending(a.filter((x) => x.status === "pending").length))} />}
      {tab === "settings" && <SettingsTab isAdmin={isAdmin} config={config} onSaved={setConfig} />}
    </div>
  );
}

// --------------------------------------------------------------------------- Referred signups
function ReferredTab({ config, seesMoney }: { config: ReferralConfig; seesMoney: boolean }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReferredBusiness[] | null>(null);
  const [q, setQ] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => listReferredBusinesses(q).then(setRows).catch((e) => toast.error(msg(e))), 250);
    return () => clearTimeout(t);
  }, [q]);

  const shown = useMemo(() => (rows ?? []).filter((r) => !onlyUnmatched || !r.matched), [rows, onlyUnmatched]);
  const reward = (r: ReferredBusiness) =>
    rewardFor({ kind: r.referrerKind, effectiveSharePercent: r.effectiveSharePercent, planKey: r.planKey, totalPaid12m: r.totalPaid12m, converted: r.converted }, config);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search business, code or referrer…" className="max-w-xs" />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} /> Unmatched codes only
        </label>
      </div>
      {rows == null ? <LoadingState /> : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead><TableHead>Code / referrer</TableHead><TableHead>Signed up</TableHead>
                <TableHead>Status</TableHead>{seesMoney && <TableHead className="text-right">Paid (12mo)</TableHead>}{seesMoney && <TableHead className="text-right">Reward owed</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && <TableRow><TableCell colSpan={seesMoney ? 6 : 4} className="py-8 text-center text-muted-foreground">No referred signups yet.</TableCell></TableRow>}
              {shown.map((r) => {
                const rw = reward(r);
                return (
                  <TableRow key={r.businessId} className="cursor-pointer" onClick={() => navigate(`/customers/${r.businessId}`)}>
                    <TableCell className="font-medium text-brand-dark">{r.businessName}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{r.code}</span>
                      <div className="text-xs text-muted-foreground">{r.matched ? `${r.referrerName}${r.referrerKind ? ` · ${KIND_LABEL[r.referrerKind]}` : ""}` : "— unregistered code"}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.signedUpAt)}</TableCell>
                    <TableCell>{r.converted ? <Badge>Paying</Badge> : <Badge variant="secondary">Signed up</Badge>}</TableCell>
                    {seesMoney && <TableCell className="text-right tabular-nums">{r.converted ? formatMoney(r.totalPaid12m) : "—"}</TableCell>}
                    {seesMoney && <TableCell className="text-right tabular-nums font-medium">
                      {!r.converted ? "—" : r.referrerKind === "business" ? <span className="text-xs font-normal text-muted-foreground">counts toward free month</span> : formatMoney(rw.cash)}
                    </TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- Referrers registry
const EMPTY_REFERRER: Referrer = { code: "", name: "", kind: "affiliate", phone: "", email: "", bankName: "", accountNumber: "", accountName: "", sharePercent: null, active: true, notes: "" };

function ReferrersTab({ isAdmin, config, seesMoney }: { isAdmin: boolean; config: ReferralConfig | null; seesMoney: boolean }) {
  const [rows, setRows] = useState<Referrer[] | null>(null);
  const [editing, setEditing] = useState<{ r: Referrer; isNew: boolean } | null>(null);
  const load = () => listReferrers().then(setRows).catch((e) => toast.error(msg(e)));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-3">
      {isAdmin && <div className="flex justify-end"><Button size="sm" onClick={() => setEditing({ r: { ...EMPTY_REFERRER }, isNew: true })}>Add referrer</Button></div>}
      {rows == null ? <LoadingState /> : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Phone</TableHead>{seesMoney && <TableHead className="text-right">Share</TableHead>}<TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No referrers registered yet.</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.code} className={r.active ? "" : "opacity-50"}>
                  <TableCell className="font-mono text-xs font-semibold">{r.code}</TableCell>
                  <TableCell className="font-medium text-brand-dark">{r.name}</TableCell>
                  <TableCell><Badge variant="secondary">{KIND_LABEL[r.kind]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{r.phone}</TableCell>
                  {seesMoney && <TableCell className="text-right text-muted-foreground">{r.kind === "affiliate" ? `${r.sharePercent ?? config?.affiliate_share_percent ?? "—"}%` : "—"}</TableCell>}
                  <TableCell className="text-right">{isAdmin && <Button variant="ghost" size="sm" onClick={() => setEditing({ r, isNew: false })}>Edit</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <ReferrerForm state={editing} config={config} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onToggle={async (code, active) => { await setReferrerActive(code, active); load(); }} />}
    </div>
  );
}

function ReferrerForm({ state, config, onClose, onSaved, onToggle }: {
  state: { r: Referrer; isNew: boolean }; config: ReferralConfig | null;
  onClose: () => void; onSaved: () => void; onToggle: (code: string, active: boolean) => void;
}) {
  const [r, setR] = useState<Referrer>(state.r);
  const [emailThem, setEmailThem] = useState(true); // email the referrer their details on add
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Referrer>) => setR((x) => ({ ...x, ...p }));

  const save = async () => {
    if (!r.name.trim() || !r.phone.trim()) return toast.error("Name and phone are required");
    if (!r.code.trim()) return toast.error("A code is required");
    setBusy(true);
    try {
      await saveReferrer(r, state.isNew);
      // On add, optionally email the referrer their code + what the program entails.
      if (state.isNew && emailThem && r.email?.trim()) {
        try { await sendReferrerWelcome(r.code.trim().toUpperCase()); toast.success(`Saved — details emailed to ${r.email}`); }
        catch (e) { toast.warning(`Saved, but the email didn't send: ${msg(e)}`); }
      } else {
        toast.success("Saved");
      }
      onSaved();
    } catch (e) { toast.error(msg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg space-y-3 rounded-xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-semibold text-brand-dark">{state.isNew ? "Add referrer" : `Edit ${r.code}`}</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Name<Input value={r.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground">Phone<Input value={r.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
          {/* Businesses aren't registered here — they opt in from their own portal (their referral
              code auto-generates on the Refer & earn card and is matched directly). Only external
              affiliates and internal staff are added manually. */}
          <label className="text-xs text-muted-foreground">Type
            <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={r.kind} onChange={(e) => set({ kind: e.target.value as ReferrerKind })}>
              <option value="affiliate">Affiliate</option><option value="staff">Staff</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Code
            <div className="mt-1 flex gap-1">
              <Input value={r.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} disabled={!state.isNew} />
              {state.isNew && <Button variant="outline" size="sm" type="button" onClick={() => set({ code: suggestCode(r.name, r.phone) })}>Suggest</Button>}
            </div>
          </label>
          <label className="text-xs text-muted-foreground">Email<Input value={r.email ?? ""} onChange={(e) => set({ email: e.target.value })} /></label>
          {r.kind === "affiliate" && (
            <label className="text-xs text-muted-foreground">Share % <span className="text-muted-foreground/70">(blank = {config?.affiliate_share_percent ?? 25}%)</span>
              <Input type="number" value={r.sharePercent ?? ""} onChange={(e) => set({ sharePercent: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
          )}
        </div>
        <div className="rounded-lg border border-border/60 p-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Payout bank details</div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-muted-foreground">Bank name<Input value={r.bankName ?? ""} onChange={(e) => set({ bankName: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Account number<Input value={r.accountNumber ?? ""} onChange={(e) => set({ accountNumber: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Account name<Input value={r.accountName ?? ""} onChange={(e) => set({ accountName: e.target.value })} /></label>
          </div>
        </div>
        {state.isNew && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={emailThem} onChange={(e) => setEmailThem(e.target.checked)} />
            Email them their code &amp; how the program works {!r.email?.trim() && <span className="text-xs">(add an email first)</span>}
          </label>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          {!state.isNew ? <Button variant="ghost" size="sm" onClick={() => onToggle(r.code, !r.active)}>{r.active ? "Deactivate" : "Reactivate"}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- Applications
function ApplicationsTab({ isAdmin, onChange }: { isAdmin: boolean; onChange: () => void }) {
  const [rows, setRows] = useState<ReferrerApplication[] | null>(null);
  const load = () => listApplications().then(setRows).catch((e) => toast.error(msg(e)));
  useEffect(() => { load(); }, []);

  const act = async (id: string, status: "approved" | "rejected") => {
    try { await setApplicationStatus(id, status); toast.success(status === "approved" ? "Approved — add them under Referrers" : "Rejected"); load(); onChange(); }
    catch (e) { toast.error(msg(e)); }
  };

  if (rows == null) return <LoadingState />;
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>How they'll promote</TableHead><TableHead>Status</TableHead>{isAdmin && <TableHead></TableHead>}</TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No affiliate applications yet.</TableCell></TableRow>}
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium text-brand-dark">{a.name}</TableCell>
              <TableCell className="text-muted-foreground"><div>{a.phone}</div>{a.email && <div className="text-xs">{a.email}</div>}</TableCell>
              <TableCell className="max-w-sm text-sm text-muted-foreground">{a.howPromote || "—"}</TableCell>
              <TableCell><Badge variant={a.status === "approved" ? "default" : a.status === "rejected" ? "destructive" : "secondary"}>{a.status}</Badge></TableCell>
              {isAdmin && <TableCell className="text-right whitespace-nowrap">
                {a.status === "pending" && <><Button variant="ghost" size="sm" onClick={() => act(a.id, "approved")}>Approve</Button><Button variant="ghost" size="sm" onClick={() => act(a.id, "rejected")}>Reject</Button></>}
              </TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// --------------------------------------------------------------------------- Program settings (View / Edit)
function SettingsTab({ isAdmin, config, onSaved }: { isAdmin: boolean; config: ReferralConfig | null; onSaved: (c: ReferralConfig) => void }) {
  const [c, setC] = useState<ReferralConfig | null>(config);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setC(config); }, [config]);
  if (!config || !c) return <LoadingState />;

  const save = async () => {
    setBusy(true);
    try { await updateReferralConfig(c); onSaved(c); setEditing(false); toast.success("Program settings saved"); }
    catch (e) { toast.error(msg(e)); } finally { setBusy(false); }
  };
  const cancel = () => { setC(config); setEditing(false); };

  const rows: { label: string; key: keyof ReferralConfig; suffix?: string }[] = [
    { label: "Affiliate share of first-year revenue", key: "affiliate_share_percent", suffix: "%" },
    { label: "Referee first-payment discount", key: "referee_discount_percent", suffix: "%" },
    { label: "Referrals a business needs for a free month", key: "business_referrals_per_free_month" },
    { label: "Free months granted at that threshold", key: "business_free_months" },
  ];

  return (
    <div className="max-w-lg space-y-4 rounded-xl border border-border/60 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-brand-dark">Program settings</h3>
        {isAdmin && !editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </div>

      {!editing ? (
        <dl className="space-y-2 text-sm">
          {rows.map((r) => (
            <div key={r.key} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium text-brand-dark">{c[r.key] as number}{r.suffix ?? ""}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Staff bonus per conversion</dt>
            <dd className="font-medium text-brand-dark">{(["pro", "business", "enterprise"] as const).map((k) => `${k}: ${formatMoney(c.staff_bonus?.[k] ?? 0)}`).join(" · ")}</dd>
          </div>
          {!isAdmin && <p className="pt-1 text-xs text-muted-foreground">Only Management/Admin can change the program settings.</p>}
        </dl>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <label key={r.key} className="block text-sm text-muted-foreground">{r.label}{r.suffix ? ` (${r.suffix})` : ""}
              <Input type="number" value={c[r.key] as number} onChange={(e) => setC({ ...c, [r.key]: Number(e.target.value) })} /></label>
          ))}
          <div className="grid grid-cols-3 gap-2">
            {(["pro", "business", "enterprise"] as const).map((k) => (
              <label key={k} className="block text-xs capitalize text-muted-foreground">{k} staff bonus
                <Input type="number" value={c.staff_bonus?.[k] ?? 0} onChange={(e) => setC({ ...c, staff_bonus: { ...c.staff_bonus, [k]: Number(e.target.value) } })} /></label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
