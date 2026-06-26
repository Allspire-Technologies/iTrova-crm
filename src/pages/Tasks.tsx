import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  listTasks,
  createTask,
  setTaskStatus,
  ROLE_LABELS,
  TYPE_LABELS,
  type TaskWithBusiness,
  type TaskFilter,
} from "@/lib/tasks";
import type { TaskRole, TaskStatus, TaskType } from "@/lib/cs";
import { useAuth } from "@/contexts/AuthContext";
import { roleCanWrite } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ROLES: TaskRole[] = ["pm", "cso", "support"];
const TYPES: TaskType[] = ["call", "meeting", "follow_up", "renewal"];
const STATUSES: TaskStatus[] = ["todo", "doing", "done"];

export default function Tasks() {
  const navigate = useNavigate();
  const canTasks = roleCanWrite(useAuth().role, "tasks"); // CSO/Admin manage tasks (§3)
  const [filter, setFilter] = useState<TaskFilter>({});
  const [tasks, setTasks] = useState<TaskWithBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Create form
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("follow_up");
  const [role, setRole] = useState<TaskRole>("cso");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);

  const filterKey = useMemo(() => JSON.stringify(filter), [filter]);

  useEffect(() => {
    let cancelled = false;
    setTasks(null);
    setError(null);
    listTasks(filter)
      .then((t) => !cancelled && setTasks(t))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load tasks."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, reloadKey]);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createTask({ title: title.trim(), type, assignee_role: role, due_date: due || null });
      setTitle("");
      setDue("");
      toast.success("Task created.");
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't create the task.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: TaskStatus) {
    const prev = tasks ?? [];
    setTasks((ts) => (ts ?? []).map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await setTaskStatus(id, status);
    } catch (e) {
      setTasks(prev);
      toast.error((e as { message?: string })?.message ?? "Couldn't update the task.");
    }
  }

  const hasFilter = Boolean(filter.role || filter.status || filter.type);

  return (
    <>
      <PageHeader title="Tasks" subtitle="The customer-success task queue — calls, meetings, follow-ups and renewals." />

      {/* Create (CSO/Admin only) */}
      {canTasks && (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-secondary/30 p-3">
        <Input className="min-w-[200px] flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" aria-label="Task title" />
        <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as TaskType)} aria-label="Task type">
          {TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value as TaskRole)} aria-label="Assign to">
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <input type="date" className={selectClass} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <Button size="sm" onClick={add} disabled={saving || !title.trim()}>Add task</Button>
      </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={selectClass} value={filter.role ?? ""} onChange={(e) => setFilter((f) => ({ ...f, role: (e.target.value || undefined) as TaskRole | undefined }))} aria-label="Filter by assignee">
          <option value="">All assignees</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <select className={selectClass} value={filter.status ?? ""} onChange={(e) => setFilter((f) => ({ ...f, status: (e.target.value || undefined) as TaskStatus | undefined }))} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
        <select className={selectClass} value={filter.type ?? ""} onChange={(e) => setFilter((f) => ({ ...f, type: (e.target.value || undefined) as TaskType | undefined }))} aria-label="Filter by type">
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
        {hasFilter && (
          <button type="button" onClick={() => setFilter({})} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : tasks === null ? (
        <LoadingState label="Loading tasks…" />
      ) : tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks" description={hasFilter ? "No tasks match these filters." : "Create a task above to get started."} />
      ) : (
        <>
        <div className="hidden rounded-xl border border-border/60 bg-card sm:block">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Task</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id} className="hover:bg-transparent">
                  <TableCell className={cn("font-medium", t.status === "done" ? "text-muted-foreground line-through" : "text-brand-dark")}>{t.title}</TableCell>
                  <TableCell>
                    {t.business_id ? (
                      <button type="button" onClick={() => navigate(`/customers/${t.business_id}`)} className="text-brand-dark underline-offset-2 hover:underline">
                        {t.business_name ?? "Business"}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">General</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{TYPE_LABELS[t.type]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{t.assignee_role ? ROLE_LABELS[t.assignee_role] : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.due_date)}</TableCell>
                  <TableCell>
                    <select
                      className={cn(selectClass, "disabled:cursor-not-allowed disabled:opacity-60")}
                      disabled={!canTasks}
                      value={t.status}
                      onChange={(e) => changeStatus(t.id, e.target.value as TaskStatus)}
                      aria-label={`Status for ${t.title}`}
                    >
                      <option value="todo">To do</option>
                      <option value="doing">Doing</option>
                      <option value="done">Done</option>
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Cards (mobile) */}
        <div className="space-y-2 sm:hidden">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-xl border border-border/60 bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <span className={cn("font-medium", t.status === "done" ? "text-muted-foreground line-through" : "text-brand-dark")}>{t.title}</span>
                <Badge variant="secondary" className="shrink-0">{TYPE_LABELS[t.type]}</Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {t.business_id ? (
                  <button type="button" onClick={() => navigate(`/customers/${t.business_id}`)} className="text-brand-dark underline-offset-2 hover:underline">
                    {t.business_name ?? "Business"}
                  </button>
                ) : (
                  <span>General</span>
                )}
                {t.assignee_role && <span>{ROLE_LABELS[t.assignee_role]}</span>}
                {t.due_date && <span>Due {formatDate(t.due_date)}</span>}
              </div>
              <select
                className={cn(selectClass, "mt-2 w-full disabled:cursor-not-allowed disabled:opacity-60")}
                disabled={!canTasks}
                value={t.status}
                onChange={(e) => changeStatus(t.id, e.target.value as TaskStatus)}
                aria-label={`Status for ${t.title}`}
              >
                <option value="todo">To do</option>
                <option value="doing">Doing</option>
                <option value="done">Done</option>
              </select>
            </div>
          ))}
        </div>
        </>
      )}
    </>
  );
}
