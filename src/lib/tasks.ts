import { supabase } from "@/integrations/supabase/client";
import { tasks as tasksCrud, type CsTask, type CsTaskInsert, type CsTaskUpdate, type TaskRole, type TaskType, type TaskStatus, type AlertKind } from "@/lib/cs";

// Tasks feature (PRD §7.7): the global, assignable CS task queue. Reads the staff-gated
// cs_task_admin view (joins the business name); writes go through the cs_task CRUD.

export type { TaskRole, TaskType, TaskStatus };

export const ROLE_LABELS: Record<TaskRole, string> = {
  pm: "Product Manager",
  cso: "Customer Success Officer",
  support: "Support Team",
};

export const TYPE_LABELS: Record<TaskType, string> = {
  call: "Call",
  meeting: "Meeting",
  follow_up: "Follow-up",
  renewal: "Renewal discussion",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "Doing",
  done: "Done",
};

export type TaskWithBusiness = CsTask & { business_name: string | null };

export type TaskFilter = { role?: TaskRole; status?: TaskStatus; type?: TaskType };

export async function listTasks(filter: TaskFilter = {}): Promise<TaskWithBusiness[]> {
  let q = supabase.from("cs_task_admin").select("*");
  if (filter.role) q = q.eq("assignee_role", filter.role);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.type) q = q.eq("type", filter.type);
  q = q.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TaskWithBusiness[];
}

export function createTask(input: CsTaskInsert): Promise<CsTask> {
  return tasksCrud.create(input);
}

export function updateTask(id: string, patch: CsTaskUpdate): Promise<CsTask> {
  return tasksCrud.update(id, patch);
}

/** Set/clear completed_at alongside a status change. */
export function setTaskStatus(id: string, status: TaskStatus): Promise<CsTask> {
  return tasksCrud.update(id, { status, completed_at: status === "done" ? new Date().toISOString() : null });
}

// --------------------------------------------------------------------------- Alert → task
const TYPE_BY_KIND: Record<AlertKind, TaskType> = {
  renewal: "renewal",
  churn: "follow_up",
  onboarding: "call",
  adoption: "call",
};
const TITLE_BY_KIND: Record<AlertKind, string> = {
  renewal: "Renewal discussion",
  churn: "Re-engage at-risk customer",
  onboarding: "Onboarding check-in",
  adoption: "Drive product adoption",
};

/** Prefill a task from an alert (PRD §7.7): business + a sensible type, due in a week. */
export function alertToTaskInput(alert: { business_id: string; kind: AlertKind }): CsTaskInsert {
  const due = new Date();
  due.setDate(due.getDate() + 7);
  return {
    business_id: alert.business_id,
    title: TITLE_BY_KIND[alert.kind],
    type: TYPE_BY_KIND[alert.kind],
    assignee_role: "cso",
    due_date: due.toISOString().slice(0, 10),
  };
}
