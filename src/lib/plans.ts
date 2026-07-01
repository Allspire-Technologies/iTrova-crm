import { supabase } from "@/integrations/supabase/client";

// Dual-control plan change (upgrade/downgrade). A Management/Admin requests a change; a DIFFERENT
// admin mints a one-time code; the requester applies it with their password + the code. Writes are
// server-side only (RPCs gated on cs_is_admin(); the apply happens in the execute-plan-change Edge
// Function). See supabase/migrations/20260701120000_plan_change_requests.sql.

// One (plan_key × cycle) price from iTrova's plan_prices_view.
export type PlanCatalogItem = {
  planKey: string;
  planName: string | null;
  cycle: string;
  priceAmount: number | null;
  discountPercent: number | null;
};

export type PlanChangeStatus = "pending" | "approved" | "executed" | "canceled" | "expired";
export type PlanChangeRequest = {
  id: string;
  businessId: string;
  fromTier: string | null;
  toTier: string;
  fromCycle: string | null;
  toCycle: string | null;
  status: PlanChangeStatus;
  requestedBy: string | null;
  requestedByName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  codeExpiresAt: string | null;
  createdAt: string;
};

/** The per-cycle plan price matrix for the picker (admin only). */
export async function listPlans(): Promise<PlanCatalogItem[]> {
  const { data, error } = await supabase.rpc("admin_list_plans");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    planKey: String(r.plan_key),
    planName: r.plan_name == null ? null : String(r.plan_name),
    cycle: String(r.cycle),
    priceAmount: r.price_amount == null ? null : Number(r.price_amount),
    discountPercent: r.discount_percent == null ? null : Number(r.discount_percent),
  }));
}

/** The in-flight (pending/approved) plan change for a business, or null. */
export async function getActivePlanChange(businessId: string): Promise<PlanChangeRequest | null> {
  const { data, error } = await supabase.rpc("admin_get_plan_change", { p_business_id: businessId });
  if (error) throw error;
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    fromTier: row.from_tier == null ? null : String(row.from_tier),
    toTier: String(row.to_tier),
    fromCycle: row.from_cycle == null ? null : String(row.from_cycle),
    toCycle: row.to_cycle == null ? null : String(row.to_cycle),
    status: String(row.status) as PlanChangeStatus,
    requestedBy: row.requested_by == null ? null : String(row.requested_by),
    requestedByName: row.requested_by_name == null ? null : String(row.requested_by_name),
    approvedBy: row.approved_by == null ? null : String(row.approved_by),
    approvedByName: row.approved_by_name == null ? null : String(row.approved_by_name),
    codeExpiresAt: row.code_expires_at == null ? null : String(row.code_expires_at),
    createdAt: String(row.created_at),
  };
}

/** Open a plan-change/renewal request for a business (returns the request id). Tier + cycle are
 *  independent (iTrova prices each plan_key per cycle); the pair is validated server-side. */
export async function requestPlanChange(businessId: string, toTier: string, toCycle: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_request_plan_change", {
    p_business_id: businessId,
    p_to_tier: toTier,
    p_to_cycle: toCycle,
  });
  if (error) throw error;
  return String(data);
}

/** Approve a request (must be a different admin than the requester) — returns the one-time code. */
export async function approvePlanChange(requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_approve_plan_change", { p_request_id: requestId });
  if (error) throw error;
  return String(data);
}

/** Cancel a stuck/abandoned request. */
export async function cancelPlanChange(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_cancel_plan_change", { p_request_id: requestId });
  if (error) throw error;
}

/** Apply the change via the Edge Function — verifies password + code server-side, then writes. */
export async function executePlanChange(requestId: string, password: string, code: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; to_tier?: string; error?: string }>(
    "execute-plan-change",
    { body: { request_id: requestId, password, code } },
  );
  if (error) {
    // Function unreachable (not deployed / not served locally).
    if ((error as { name?: string }).name === "FunctionsFetchError" || /failed to send a request/i.test(error.message)) {
      throw new Error("Couldn't reach the plan-change function — deploy it: supabase functions deploy execute-plan-change");
    }
    // Otherwise surface the function's JSON error body if present.
    let message = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) message = body.error;
    } catch {
      /* fall back to error.message */
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.ok) throw new Error("The plan change did not complete.");
}
