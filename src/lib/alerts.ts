import { supabase } from "@/integrations/supabase/client";
import { alerts as alertsCrud, type CsAlert } from "@/lib/cs";

// Typed access to the Customer Success Workflow / alert engine (PRD §7.5). The engine
// (cs_eval_alerts*) writes cs_alert rows; the app reads open alerts, triggers an on-demand
// re-evaluation via the staff-gated RPC, and acknowledges/resolves. Staff-only at the DB layer.

export type ActiveAlert = CsAlert & { business_name: string };

/** Open alerts across businesses with the business name, criticals first (for Home). */
export async function listActiveAlertsForHome(): Promise<ActiveAlert[]> {
  const { data, error } = await supabase
    .from("cs_alert_active")
    .select("*")
    .order("severity", { ascending: true }) // 'critical' < 'warning'
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ActiveAlert[];
}

/** All open (active or acknowledged) alerts across businesses, criticals first. */
export async function listActiveAlerts(): Promise<CsAlert[]> {
  const { data, error } = await supabase
    .from("cs_alert")
    .select("*")
    .neq("status", "resolved")
    .order("severity", { ascending: true }) // 'critical' < 'warning'
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CsAlert[];
}

/** Open alerts for one business. */
export async function listBusinessAlerts(businessId: string): Promise<CsAlert[]> {
  const { data, error } = await supabase
    .from("cs_alert")
    .select("*")
    .eq("business_id", businessId)
    .neq("status", "resolved")
    .order("severity", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CsAlert[];
}

/** Re-evaluate one business now; returns its open alerts. */
export async function recomputeAlerts(businessId: string): Promise<CsAlert[]> {
  const { data, error } = await supabase.rpc("cs_recompute_alerts_business", { p_business_id: businessId });
  if (error) throw error;
  return (data ?? []) as CsAlert[];
}

export function acknowledgeAlert(id: string, acknowledgedBy: string): Promise<CsAlert> {
  return alertsCrud.update(id, { status: "acknowledged", acknowledged_by: acknowledgedBy });
}

export function resolveAlert(id: string): Promise<CsAlert> {
  return alertsCrud.update(id, { status: "resolved", resolved_at: new Date().toISOString() });
}
