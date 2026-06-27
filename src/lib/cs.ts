import { supabase } from "@/integrations/supabase/client";

// Typed create/read/update access to the dashboard-owned CRM tables (public.cs_*, PRD §6.2).
// Reads/writes are staff-only at the DB layer (RLS gated on is_platform_admin()); author /
// created_by are stamped server-side from auth.uid(), so they are omitted from insert types.
// Rows are returned in the DB's snake_case shape (as PostgREST returns them).

type Iso = string;

// ----------------------------------------------------------------------------
// Row types
// ----------------------------------------------------------------------------
export type CsAccountAssignment = {
  business_id: string;
  account_manager_id: string | null;
  assigned_at: Iso;
  created_at: Iso;
  updated_at: Iso;
};

export type HealthBand = "green" | "yellow" | "red";
export type CsHealthSnapshot = {
  id: string;
  business_id: string;
  score: number;
  band: HealthBand;
  reasons: unknown;
  captured_at: Iso;
  created_at: Iso;
  updated_at: Iso;
};

export type PipelineStage =
  | "lead"
  | "registered"
  | "subscribed"
  | "onboarding"
  | "active"
  | "power_user"
  | "renewed"
  | "churned";
export type CsPipeline = {
  business_id: string;
  stage: PipelineStage;
  stage_source: "auto" | "manual";
  created_at: Iso;
  updated_at: Iso;
};

export type NoteType = "meeting" | "call" | "general";
export type CsNote = {
  id: string;
  business_id: string;
  author_id: string | null;
  type: NoteType;
  body: string;
  created_at: Iso;
  updated_at: Iso;
};

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "med" | "high" | "urgent";
export type CsTicket = {
  id: string;
  business_id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee_id: string | null;
  created_by: string | null;
  created_at: Iso;
  updated_at: Iso;
  resolved_at: Iso | null;
};

export type FeatureRequestStatus = "new" | "planned" | "shipped" | "declined";
export type CsFeatureRequest = {
  id: string;
  business_id: string;
  title: string;
  detail: string | null;
  status: FeatureRequestStatus;
  votes: number;
  created_by: string | null;
  created_at: Iso;
  updated_at: Iso;
};

export type CsFeedback = {
  id: string;
  business_id: string;
  rating: number | null;
  body: string | null;
  created_by: string | null;
  created_at: Iso;
  updated_at: Iso;
};

export type TaskType = "call" | "meeting" | "follow_up" | "renewal";
export type TaskStatus = "todo" | "doing" | "done";
export type TaskRole = "pm" | "cso" | "support";
export type CsTask = {
  id: string;
  business_id: string | null;
  title: string;
  type: TaskType;
  assignee_role: TaskRole | null;
  assignee_id: string | null;
  created_by: string | null;
  due_date: string | null;
  status: TaskStatus;
  created_at: Iso;
  updated_at: Iso;
  completed_at: Iso | null;
};

export type AlertKind = "onboarding" | "adoption" | "churn" | "renewal";
export type AlertSeverity = "warning" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved";
export type CsAlert = {
  id: string;
  business_id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  detail: string | null;
  status: AlertStatus;
  acknowledged_by: string | null;
  created_at: Iso;
  updated_at: Iso;
  resolved_at: Iso | null;
};

// ----------------------------------------------------------------------------
// Insert / Update shapes (author/created_by/timestamps are server-managed)
// ----------------------------------------------------------------------------
export type CsHealthSnapshotInsert = {
  business_id: string;
  score: number;
  band: HealthBand;
  reasons?: unknown;
  captured_at?: Iso;
};

export type CsNoteInsert = { business_id: string; type?: NoteType; body: string };
export type CsNoteUpdate = Partial<{ type: NoteType; body: string }>;

export type CsTicketInsert = {
  business_id: string;
  title: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee_id?: string | null;
};
export type CsTicketUpdate = Partial<{
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee_id: string | null;
  resolved_at: Iso | null;
}>;

export type CsFeatureRequestInsert = {
  business_id: string;
  title: string;
  detail?: string | null;
  status?: FeatureRequestStatus;
  votes?: number;
};
export type CsFeatureRequestUpdate = Partial<{
  title: string;
  detail: string | null;
  status: FeatureRequestStatus;
  votes: number;
}>;

export type CsFeedbackInsert = { business_id: string; rating?: number | null; body?: string | null };
export type CsFeedbackUpdate = Partial<{ rating: number | null; body: string | null }>;

export type CsTaskInsert = {
  business_id?: string | null;
  title: string;
  type?: TaskType;
  assignee_role?: TaskRole | null;
  assignee_id?: string | null;
  due_date?: string | null;
  status?: TaskStatus;
};
export type CsTaskUpdate = Partial<{
  title: string;
  type: TaskType;
  assignee_role: TaskRole | null;
  assignee_id: string | null;
  due_date: string | null;
  status: TaskStatus;
  completed_at: Iso | null;
}>;

export type CsAlertInsert = {
  business_id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  detail?: string | null;
  status?: AlertStatus;
};
export type CsAlertUpdate = Partial<{
  severity: AlertSeverity;
  detail: string | null;
  status: AlertStatus;
  acknowledged_by: string | null;
  resolved_at: Iso | null;
}>;

// ----------------------------------------------------------------------------
// CRUD factory for id-keyed tables (read list/one, create, update by id)
// ----------------------------------------------------------------------------
type ListFilter = { businessId?: string };

function table<Row, Insert, Update>(name: string) {
  return {
    async list(filter: ListFilter = {}): Promise<Row[]> {
      let q = supabase.from(name).select("*").order("created_at", { ascending: false });
      if (filter.businessId) q = q.eq("business_id", filter.businessId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    async get(id: string): Promise<Row | null> {
      const { data, error } = await supabase.from(name).select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Row | null;
    },
    async create(input: Insert): Promise<Row> {
      const { data, error } = await supabase.from(name).insert(input as object).select().single();
      if (error) throw error;
      return data as Row;
    },
    async update(id: string, patch: Update): Promise<Row> {
      const { data, error } = await supabase.from(name).update(patch as object).eq("id", id).select().single();
      if (error) throw error;
      return data as Row;
    },
  };
}

export const healthSnapshots = table<CsHealthSnapshot, CsHealthSnapshotInsert, never>("cs_health_snapshot");
export const notes = table<CsNote, CsNoteInsert, CsNoteUpdate>("cs_note");
export const tickets = table<CsTicket, CsTicketInsert, CsTicketUpdate>("cs_ticket");
export const featureRequests = table<CsFeatureRequest, CsFeatureRequestInsert, CsFeatureRequestUpdate>("cs_feature_request");
export const feedback = table<CsFeedback, CsFeedbackInsert, CsFeedbackUpdate>("cs_feedback");
export const tasks = table<CsTask, CsTaskInsert, CsTaskUpdate>("cs_task");
export const alerts = table<CsAlert, CsAlertInsert, CsAlertUpdate>("cs_alert");

// ----------------------------------------------------------------------------
// business_id-keyed singletons (one row per business) — read + upsert
// ----------------------------------------------------------------------------
export const accountAssignment = {
  async get(businessId: string): Promise<CsAccountAssignment | null> {
    const { data, error } = await supabase
      .from("cs_account_assignment")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as CsAccountAssignment | null;
  },
  async set(businessId: string, accountManagerId: string | null): Promise<CsAccountAssignment> {
    const { data, error } = await supabase
      .from("cs_account_assignment")
      .upsert(
        { business_id: businessId, account_manager_id: accountManagerId, assigned_at: new Date().toISOString() },
        { onConflict: "business_id" },
      )
      .select()
      .single();
    if (error) throw error;
    return data as CsAccountAssignment;
  },
  /** Bulk-assign (or clear) the account manager for many businesses at once. */
  async setMany(businessIds: string[], accountManagerId: string | null): Promise<void> {
    if (businessIds.length === 0) return;
    const assignedAt = new Date().toISOString();
    const rows = businessIds.map((business_id) => ({
      business_id,
      account_manager_id: accountManagerId,
      assigned_at: assignedAt,
    }));
    const { error } = await supabase
      .from("cs_account_assignment")
      .upsert(rows, { onConflict: "business_id" });
    if (error) throw error;
  },
};

// ----------------------------------------------------------------------------
// cs_lead — standalone prospects for the pipeline's Lead column (decoupled from businesses).
// All fields are optional; status/created_by/timestamps are server-managed.
// ----------------------------------------------------------------------------
export type LeadStatus = "open" | "converted" | "lost";
export type CsLead = {
  id: string;
  name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source: string | null;
  notes: string | null;
  status: LeadStatus;
  business_id: string | null;
  created_by: string | null;
  created_at: Iso;
  updated_at: Iso;
};
export type CsLeadInsert = Partial<{
  name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source: string | null;
  notes: string | null;
}>;
export type CsLeadUpdate = Partial<{
  name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source: string | null;
  notes: string | null;
  status: LeadStatus;
  business_id: string | null;
}>;

export const leads = {
  async list(status: LeadStatus | "all" = "open"): Promise<CsLead[]> {
    let q = supabase.from("cs_lead").select("*").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as CsLead[];
  },
  async create(input: CsLeadInsert): Promise<CsLead> {
    const { data, error } = await supabase.from("cs_lead").insert(input as object).select().single();
    if (error) throw error;
    return data as CsLead;
  },
  async update(id: string, patch: CsLeadUpdate): Promise<CsLead> {
    const { data, error } = await supabase.from("cs_lead").update(patch as object).eq("id", id).select().single();
    if (error) throw error;
    return data as CsLead;
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("cs_lead").delete().eq("id", id);
    if (error) throw error;
  },
};

export const pipeline = {
  async get(businessId: string): Promise<CsPipeline | null> {
    const { data, error } = await supabase
      .from("cs_pipeline")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as CsPipeline | null;
  },
  async set(businessId: string, stage: PipelineStage, source: "auto" | "manual" = "manual"): Promise<CsPipeline> {
    const { data, error } = await supabase
      .from("cs_pipeline")
      .upsert({ business_id: businessId, stage, stage_source: source }, { onConflict: "business_id" })
      .select()
      .single();
    if (error) throw error;
    return data as CsPipeline;
  },
};
