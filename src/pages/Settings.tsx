import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Users, ShieldCheck, Lock } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { getHealthSettings, updateHealthSettings, type HealthSettings, type HealthSettingsUpdate } from "@/lib/health";
import { listCustomersPage, type CustomerPageRow } from "@/lib/customers";
import { getCustomersFacets, type CustomersFacets } from "@/lib/admin";
import { accountAssignment } from "@/lib/cs";
import { listStaffRoles, setStaffRole, STAFF_ROLE_LABELS, STAFF_ROLES, type StaffRole, type StaffWithRole } from "@/lib/roles";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

type FieldKey = keyof HealthSettingsUpdate;
const FIELD_GROUPS: { title: string; fields: { key: FieldKey; label: string; hint?: string }[] }[] = [
  {
    title: "Login recency (days)",
    fields: [
      { key: "login_green_days", label: "Healthy within" },
      { key: "login_yellow_days", label: "Warning after" },
      { key: "login_red_days", label: "Critical after", hint: "also the no-login trip-wire" },
    ],
  },
  {
    title: "Sales activity (days)",
    fields: [
      { key: "sales_green_days", label: "Recent within" },
      { key: "sales_mid_days", label: "Mid within" },
      { key: "sales_window_days", label: "Counts within" },
      { key: "warning_no_sales_days", label: "Warn if none for" },
    ],
  },
  {
    title: "Inventory & adoption (days)",
    fields: [
      { key: "products_stale_days", label: "Products fresh within" },
      { key: "adoption_active_days", label: "Active user within" },
    ],
  },
  {
    title: "Renewal (days)",
    fields: [
      { key: "renewal_healthy_days", label: "Healthy if renewal >" },
      { key: "renewal_window_days", label: "Renewal-due window" },
    ],
  },
  {
    title: "Health score cutoffs (0–100)",
    fields: [
      { key: "band_green_min", label: "Green at or above" },
      { key: "band_yellow_min", label: "Red below" },
    ],
  },
];

const ROLE_MATRIX = [
  { role: "Customer Success Officer", sees: "All customers, health, pipeline, tasks", does: "Notes/tickets/tasks, move pipeline, own renewals" },
  { role: "Product Manager", sees: "All customers, usage analytics, feature requests", does: "Triage feature requests, own adoption" },
  { role: "Support Team", sees: "Assigned customers, tickets", does: "Work tickets, log calls/meetings" },
  { role: "Management / Admin", sees: "Everything + revenue", does: "Full access, assign managers, tune thresholds" },
];

function AdminNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock className="size-3.5" /> {children}
    </p>
  );
}

function ThresholdsCard({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<HealthSettings | null>(null);
  const [form, setForm] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setError(null);
    getHealthSettings()
      .then((s) => {
        if (cancelled || !s) return;
        setSettings(s);
        const f: Record<string, number> = {};
        for (const g of FIELD_GROUPS) for (const fld of g.fields) f[fld.key] = (s as unknown as Record<string, number>)[fld.key];
        setForm(f);
      })
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load settings."));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const dirty = useMemo(() => {
    if (!settings) return false;
    return FIELD_GROUPS.some((g) => g.fields.some((f) => form[f.key] !== (settings as unknown as Record<string, number>)[f.key]));
  }, [form, settings]);

  async function save() {
    setSaving(true);
    try {
      const patch: HealthSettingsUpdate = {};
      for (const g of FIELD_GROUPS) for (const f of g.fields) (patch as Record<string, number>)[f.key] = Number(form[f.key]);
      const updated = await updateHealthSettings(patch);
      setSettings(updated);
      toast.success("Thresholds saved — the engine uses them on the next recompute.");
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4" /> Health & alert thresholds</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : !settings ? (
          <LoadingState label="Loading thresholds…" />
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              These tune the health engine in place (no redeploy). Changes apply on the next nightly snapshot or an on-demand recompute.
            </p>
            {FIELD_GROUPS.map((g) => (
              <div key={g.title}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {g.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="text-sm text-foreground">{f.label}</span>
                      <Input
                        type="number"
                        min={0}
                        disabled={!canEdit}
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                        className="mt-1"
                      />
                      {f.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{f.hint}</span>}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {canEdit ? (
              <div className="flex items-center gap-3">
                <Button onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save thresholds"}</Button>
                {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
              </div>
            ) : (
              <AdminNote>Only Management/Admin can change thresholds.</AdminNote>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssignmentCard({ canEdit }: { canEdit: boolean }) {
  const [facets, setFacets] = useState<CustomersFacets | null>(null);
  const [rows, setRows] = useState<CustomerPageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    getCustomersFacets().then(setFacets).catch(() => setFacets({ plans: [], industries: [], managers: [] }));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    listCustomersPage({ search: query || undefined, pageSize: 10, sort: "name", dir: "asc" })
      .then((p) => !cancelled && setRows(p.rows))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load businesses."));
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  async function assign(row: CustomerPageRow, managerId: string) {
    const id = managerId || null;
    const name = id ? facets?.managers.find((m) => m.id === id)?.name ?? null : null;
    const prev = rows ?? [];
    setRows((rs) => (rs ?? []).map((r) => (r.businessId === row.businessId ? { ...r, accountManagerId: id, accountManagerName: name } : r)));
    try {
      await accountAssignment.set(row.businessId, id);
      toast.success(`${row.name}: ${name ?? "unassigned"}.`);
    } catch (e) {
      setRows(prev);
      toast.error((e as { message?: string })?.message ?? "Couldn't update assignment.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Account-manager assignment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search businesses…" className="max-w-sm" aria-label="Search businesses" />
        {error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows === null ? (
          <LoadingState label="Loading businesses…" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No businesses match “{query}”.</p>
        ) : (
          <div className="rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Business</TableHead>
                  <TableHead>Account manager</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.businessId} className="hover:bg-transparent">
                    <TableCell className="font-medium text-brand-dark">{r.name}</TableCell>
                    <TableCell>
                      <select
                        className={selectClass}
                        disabled={!canEdit}
                        value={r.accountManagerId ?? ""}
                        onChange={(e) => assign(r, e.target.value)}
                        aria-label={`Account manager for ${r.name}`}
                      >
                        <option value="">Unassigned</option>
                        {facets?.managers.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {canEdit ? (
          <p className="text-xs text-muted-foreground">Showing up to 10 matches — search to narrow. Bulk assignment is also available on the Customers table.</p>
        ) : (
          <AdminNote>Only Management/Admin can assign account managers.</AdminNote>
        )}
      </CardContent>
    </Card>
  );
}

function RolesCard({ isAdmin }: { isAdmin: boolean }) {
  const [staff, setStaff] = useState<StaffWithRole[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStaff(null);
    setError(null);
    listStaffRoles()
      .then((s) => !cancelled && setStaff(s))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load staff."));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function change(s: StaffWithRole, role: StaffRole) {
    const prev = staff ?? [];
    setStaff((list) => (list ?? []).map((x) => (x.userId === s.userId ? { ...x, role } : x)));
    try {
      await setStaffRole(s.userId, role);
      toast.success(`${s.name ?? s.email}: ${STAFF_ROLE_LABELS[role]}.`);
    } catch (e) {
      setStaff(prev);
      toast.error((e as { message?: string })?.message ?? "Couldn't update role.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Roles & visibility</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Assign each internal user a role." : "Your access is set by your role."} Only Management/Admin can change roles.
        </p>

        {error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : staff === null ? (
          <LoadingState label="Loading staff…" />
        ) : (
          <div className="rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((s) => (
                  <TableRow key={s.userId} className="hover:bg-transparent">
                    <TableCell className="font-medium text-brand-dark">{s.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.email ?? "—"}</TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <select
                          className={selectClass}
                          value={s.role}
                          onChange={(e) => change(s, e.target.value as StaffRole)}
                          aria-label={`Role for ${s.name ?? s.email}`}
                        >
                          {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-muted-foreground">{STAFF_ROLE_LABELS[s.role]}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* §3 reference: what each role can see / do */}
        <div className="rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Role</TableHead>
                <TableHead>Can see</TableHead>
                <TableHead>Can do</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLE_MATRIX.map((r) => (
                <TableRow key={r.role} className="hover:bg-transparent">
                  <TableCell className="font-medium text-brand-dark">{r.role}</TableCell>
                  <TableCell className="text-muted-foreground">{r.sees}</TableCell>
                  <TableCell className="text-muted-foreground">{r.does}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  return (
    <>
      <PageHeader title="Settings" subtitle="Tune the engine, manage account managers and review roles." />
      <div className="space-y-6">
        <ThresholdsCard canEdit={isAdmin} />
        <AssignmentCard canEdit={isAdmin} />
        <RolesCard isAdmin={isAdmin} />
      </div>
    </>
  );
}
