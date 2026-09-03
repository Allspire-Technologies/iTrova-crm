import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AsTable, Row, deleteRow, listRows, saveRow, uploadAllspireMedia } from "@/lib/allspire";
import { EditorShell, PublishedPill } from "./EditorShell";

// Schema-driven CMS collection: a table + create/edit dialog generated from field specs, so
// every Allspire collection (logos, stats, case studies, ...) is a config, not a page.

export type FieldSpec = {
  key: string;
  label: string;
  type: "text" | "textarea" | "markdown" | "number" | "boolean" | "image" | "tags" | "select" | "json";
  required?: boolean;
  hint?: string;
  options?: string[];
  /** For image uploads: the folder under allspire/ in the media bucket. */
  folder?: string;
  /** Derive this field from another when the user has not typed it (e.g. slug from title). */
  deriveFrom?: { key: string; fn: (v: string) => string };
};

export type CollectionConfig = {
  table: AsTable;
  title: string;
  blurb: string;
  fields: FieldSpec[];
  /** Columns shown in the list (field keys). */
  columns: string[];
  /** Primary key column (default id). */
  pk?: string;
  /** Single-row collection: no list, the editor renders inline. */
  singleton?: boolean;
  wide?: boolean;
  orderBy?: string[];
  /** Human name for a row in confirmations. */
  rowLabel?: (r: Row) => string;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const EM_DASH = /—/;

function emptyRow(fields: FieldSpec[]): Row {
  const r: Row = {};
  for (const f of fields) r[f.key] = f.type === "boolean" ? false : f.type === "tags" || f.type === "json" ? [] : f.type === "number" ? 0 : "";
  return r;
}

function cell(v: unknown, f?: FieldSpec) {
  if (f?.type === "boolean") return <PublishedPill on={!!v} />;
  if (f?.type === "image") return v ? <img src={String(v)} alt="" className="h-8 w-auto rounded" /> : <span className="text-muted-foreground">·</span>;
  if (Array.isArray(v)) return v.length ? v.join(", ") : <span className="text-muted-foreground">·</span>;
  if (v == null || v === "") return <span className="text-muted-foreground">·</span>;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return <span className="line-clamp-1 max-w-xs">{s}</span>;
}

export function CollectionTab({ config, isAdmin }: { config: CollectionConfig; isAdmin: boolean }) {
  const pk = config.pk ?? "id";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);

  const reload = useCallback(() => {
    listRows(config.table, config.orderBy).then(setRows).catch((e) => {
      setRows([]);
      toast.error(msg(e));
    });
  }, [config.table, config.orderBy]);
  useEffect(reload, [reload]);

  if (rows == null) return <LoadingState />;

  if (config.singleton) {
    const row = rows[0] ?? emptyRow(config.fields);
    return (
      <section>
        <p className="mb-3 text-sm text-muted-foreground">{config.blurb}</p>
        <RowForm config={config} row={row} inline isAdmin={isAdmin} onSaved={reload} onClose={() => {}} />
      </section>
    );
  }

  const byKey = Object.fromEntries(config.fields.map((f) => [f.key, f]));
  const label = config.rowLabel ?? ((r: Row) => String(r.title ?? r.name ?? r.label ?? r.key ?? r[pk]));

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{config.blurb}</p>
        {isAdmin && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> New
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              {config.columns.map((c) => (
                <TableHead key={c}>{byKey[c]?.label ?? c}</TableHead>
              ))}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={config.columns.length + 1} className="py-8 text-center text-muted-foreground">
                  Nothing yet. The site keeps this section hidden until the first published item.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={String(r[pk])}>
                {config.columns.map((c) => (
                  <TableCell key={c} className={c === config.columns[0] ? "font-medium" : "text-muted-foreground"}>
                    {cell(r[c], byKey[c])}
                  </TableCell>
                ))}
                <TableCell className="whitespace-nowrap text-right">
                  {isAdmin && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>Delete</Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <EditorShell
          title={editing === "new" ? `New ${config.title.toLowerCase().replace(/s$/, "")}` : `Edit ${label(editing)}`}
          wide={config.wide}
          onClose={() => setEditing(null)}
        >
          <RowForm
            config={config}
            row={editing === "new" ? emptyRow(config.fields) : editing}
            isAdmin={isAdmin}
            onSaved={() => { setEditing(null); reload(); }}
            onClose={() => setEditing(null)}
          />
        </EditorShell>
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={`Delete ${label(removing)}?`}
          description="It disappears from allspire.tech immediately. This cannot be undone."
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            try {
              await deleteRow(config.table, removing[pk], pk);
              toast.success("Deleted");
              setRemoving(null);
              reload();
            } catch (e) {
              toast.error(msg(e));
            }
          }}
        />
      )}
    </section>
  );
}

function RowForm({
  config,
  row,
  isAdmin,
  inline = false,
  onSaved,
  onClose,
}: {
  config: CollectionConfig;
  row: Row;
  isAdmin: boolean;
  inline?: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const pk = config.pk ?? "id";
  const [values, setValues] = useState<Row>(() => ({ ...row }));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  // The key the row was loaded with: updates filter on it even if the user edits the key itself.
  const originalKey = row[pk];

  const set = (key: string, v: unknown) => {
    setTouched((t) => ({ ...t, [key]: true }));
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      // Derived fields (e.g. slug from title) follow until the user edits them directly.
      for (const f of config.fields) {
        if (f.deriveFrom?.key === key && !touched[f.key] && typeof v === "string") next[f.key] = f.deriveFrom.fn(v);
      }
      return next;
    });
  };

  const upload = async (f: FieldSpec, file: File) => {
    setUploading(f.key);
    try {
      set(f.key, await uploadAllspireMedia(file, f.folder ?? "media"));
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    const out: Row = { ...values };
    for (const f of config.fields) {
      const v = out[f.key];
      if (f.type === "text" || f.type === "textarea" || f.type === "markdown") out[f.key] = typeof v === "string" ? v.trim() : v ?? "";
      if (f.type === "number") out[f.key] = Number(v) || 0;
      if (f.type === "tags") out[f.key] = Array.isArray(v) ? v : String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (f.type === "json") {
        try { out[f.key] = typeof v === "string" ? JSON.parse(v) : v; } catch { return toast.error(`${f.label} must be valid JSON`); }
      }
      if (f.required && (out[f.key] == null || out[f.key] === "")) return toast.error(`${f.label} is required`);
      if (typeof out[f.key] === "string" && EM_DASH.test(out[f.key] as string)) return toast.error(`Remove em dashes (—) from ${f.label}`);
    }
    setBusy(true);
    try {
      await saveRow(config.table, out, pk, originalKey);
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const disabled = !isAdmin;
  const field = (f: FieldSpec) => {
    const v = values[f.key];
    const base = "mt-1 w-full rounded-md border border-input bg-background text-sm";
    switch (f.type) {
      case "boolean":
        return (
          <label key={f.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={disabled} checked={!!v} onChange={(e) => set(f.key, e.target.checked)} />
            {f.label}
          </label>
        );
      case "textarea":
      case "markdown":
      case "json":
        return (
          <label key={f.key} className="block text-xs text-muted-foreground">
            {f.label}{f.required && " *"}{f.hint && <span className="ml-1 opacity-80">({f.hint})</span>}
            <textarea
              disabled={disabled}
              className={`${base} p-3 ${f.type === "markdown" ? "min-h-48 font-mono" : f.type === "json" ? "min-h-32 font-mono" : "min-h-20"}`}
              value={f.type === "json" && typeof v !== "string" ? JSON.stringify(v ?? [], null, 2) : String(v ?? "")}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </label>
        );
      case "select":
        return (
          <label key={f.key} className="block text-xs text-muted-foreground">
            {f.label}{f.required && " *"}
            <select disabled={disabled} className={`${base} h-10 px-3`} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">None</option>
              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        );
      case "image":
        return (
          <div key={f.key} className="flex items-end gap-2">
            <label className="block flex-1 text-xs text-muted-foreground">
              {f.label}{f.required && " *"}{f.hint && <span className="ml-1 opacity-80">({f.hint})</span>}
              <Input disabled={disabled} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />
            </label>
            {!disabled && (
              <>
                <input
                  ref={(el) => { fileInputs.current[f.key] = el; }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload(f, file); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  disabled={uploading !== null}
                  aria-label={`Upload ${f.label.toLowerCase()}`}
                  onClick={() => fileInputs.current[f.key]?.click()}
                >
                  <Upload className="size-4" /> {uploading === f.key ? "Uploading…" : "Upload"}
                </Button>
              </>
            )}
            {!!v && <img src={String(v)} alt="" className="h-10 w-auto rounded border border-border/60" />}
          </div>
        );
      case "tags":
        return (
          <label key={f.key} className="block text-xs text-muted-foreground">
            {f.label} (comma separated)
            <Input disabled={disabled} value={Array.isArray(v) ? v.join(", ") : String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />
          </label>
        );
      case "number":
        return (
          <label key={f.key} className="block text-xs text-muted-foreground">
            {f.label}
            <Input disabled={disabled} type="number" className="w-28" value={String(v ?? 0)} onChange={(e) => set(f.key, e.target.value)} />
          </label>
        );
      default:
        return (
          <label key={f.key} className="block text-xs text-muted-foreground">
            {f.label}{f.required && " *"}{f.hint && <span className="ml-1 opacity-80">({f.hint})</span>}
            <Input disabled={disabled} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />
          </label>
        );
    }
  };

  return (
    <div className={inline ? "max-w-2xl space-y-3 rounded-xl border border-border/60 bg-card p-5" : "space-y-3"}>
      {config.fields.map(field)}
      {isAdmin && (
        <div className="flex justify-end gap-2 pt-1">
          {!inline && <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>}
          <Button size="sm" onClick={save} disabled={busy || uploading !== null}>
            {busy ? "Saving…" : uploading ? "Uploading…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
