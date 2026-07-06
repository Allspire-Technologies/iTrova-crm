// Cross-customer "worklist": every item captured in a customer's Notes & CRM section (notes,
// tickets, feature requests, feedback, tasks) in one shape, read from the cs_worklist_admin view.
// Status changes are dispatched back to the right underlying table, mirroring the customer-page tabs.
import { supabase } from "@/integrations/supabase/client";
import {
  tickets,
  featureRequests,
  tasks,
  type TicketStatus,
  type FeatureRequestStatus,
  type TaskStatus,
} from "@/lib/cs";

export type WorklistKind = "note" | "ticket" | "feature" | "feedback" | "task";

export type WorklistItem = {
  kind: WorklistKind;
  id: string;
  business_id: string | null;
  business_name: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  sub_type: string | null;
  rating: number | null;
  votes: number | null;
  due_date: string | null;
  assignee_role: string | null;
  created_at: string;
  closed_at: string | null; // when the item reached a closed status (view-derived)
};

export type StatusGroup = "open" | "closed" | "archived";
export type WorklistFilter = { kind?: WorklistKind; group?: StatusGroup };

// Closed items are ARCHIVED (hidden from the default and "closed" views, reachable via the
// explicit Archived filter) once they've been closed for this many days. Nothing is deleted.
export const ARCHIVE_AFTER_DAYS = 7;

export function isPastArchiveWindow(closedAt: string | null | undefined): boolean {
  if (!closedAt) return false;
  return Date.now() - new Date(closedAt).getTime() > ARCHIVE_AFTER_DAYS * 86_400_000;
}

export const KIND_LABELS: Record<WorklistKind, string> = {
  note: "Note",
  ticket: "Ticket",
  feature: "Feature request",
  feedback: "Feedback",
  task: "Task",
};

// The status options each editable kind exposes (label/value), matching the customer-page tabs.
export const STATUS_OPTIONS: Record<"ticket" | "feature" | "task", { value: string; label: string }[]> = {
  ticket: [
    { value: "open", label: "Open" },
    { value: "in_progress", label: "In progress" },
    { value: "resolved", label: "Resolved" },
    { value: "closed", label: "Closed" },
  ],
  feature: [
    { value: "new", label: "New" },
    { value: "planned", label: "Planned" },
    { value: "shipped", label: "Shipped" },
    { value: "declined", label: "Declined" },
  ],
  task: [
    { value: "todo", label: "To do" },
    { value: "doing", label: "Doing" },
    { value: "done", label: "Done" },
  ],
};

// Which statuses mean "still needs attention" vs "closed/done", per kind — powers the Open/Closed
// filter across kinds. Notes and feedback have no status, so they belong to neither group.
const OPEN_STATUSES: Record<string, readonly string[]> = {
  ticket: ["open", "in_progress"],
  feature: ["new", "planned"],
  task: ["todo", "doing"],
};

export function statusGroup(item: Pick<WorklistItem, "kind" | "status" | "closed_at">): StatusGroup | null {
  const open = OPEN_STATUSES[item.kind];
  if (!open || !item.status) return null;
  if (open.includes(item.status)) return "open";
  return isPastArchiveWindow(item.closed_at) ? "archived" : "closed";
}

/** True for the kinds whose status can be edited inline (notes/feedback are read-only). */
export function isEditableKind(kind: WorklistKind): kind is "ticket" | "feature" | "task" {
  return kind === "ticket" || kind === "feature" || kind === "task";
}

export async function listWorklist(filter: WorklistFilter = {}): Promise<WorklistItem[]> {
  let q = supabase.from("cs_worklist_admin").select("*").order("created_at", { ascending: false });
  if (filter.kind) q = q.eq("kind", filter.kind);
  const { data, error } = await q;
  if (error) throw error;
  const items = (data ?? []) as WorklistItem[];
  // Explicit group filter shows exactly that group; the default view hides archived items
  // (closed > ARCHIVE_AFTER_DAYS days ago) — they're reachable via the Archived filter.
  if (filter.group) return items.filter((i) => statusGroup(i) === filter.group);
  return items.filter((i) => statusGroup(i) !== "archived");
}

/** Dispatch an inline status change to the item's own table (with the same side-effects as the tabs). */
export async function updateWorklistStatus(item: WorklistItem, status: string): Promise<void> {
  if (item.kind === "ticket") {
    await tickets.update(item.id, {
      status: status as TicketStatus,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    });
  } else if (item.kind === "feature") {
    await featureRequests.update(item.id, { status: status as FeatureRequestStatus });
  } else if (item.kind === "task") {
    await tasks.update(item.id, {
      status: status as TaskStatus,
      completed_at: status === "done" ? new Date().toISOString() : null,
    });
  }
}
