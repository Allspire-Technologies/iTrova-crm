import { supabase } from "@/integrations/supabase/client";
import type { HealthBand, CsHealthSnapshot } from "@/lib/cs";

// Typed access to the Customer Health Engine (PRD §7.3). Reads the current band from the
// cs_health_current view, triggers an on-demand recompute via the staff-gated RPC, and
// reads/edits the tunable thresholds in cs_settings. All staff-only at the DB layer.

export type CurrentHealth = {
  business_id: string;
  score: number;
  band: HealthBand;
  reasons: unknown;
  captured_at: string;
};

export async function listCurrentHealth(): Promise<CurrentHealth[]> {
  const { data, error } = await supabase.from("cs_health_current").select("*");
  if (error) throw error;
  return (data ?? []) as CurrentHealth[];
}

export async function getCurrentHealth(businessId: string): Promise<CurrentHealth | null> {
  const { data, error } = await supabase
    .from("cs_health_current")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as CurrentHealth | null;
}

export async function listHealthHistory(businessId: string): Promise<CsHealthSnapshot[]> {
  const { data, error } = await supabase
    .from("cs_health_snapshot")
    .select("*")
    .eq("business_id", businessId)
    .order("captured_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CsHealthSnapshot[];
}

/** Recompute one business now and store a fresh snapshot. Returns the new snapshot. */
export async function recomputeHealth(businessId: string): Promise<CsHealthSnapshot> {
  const { data, error } = await supabase.rpc("cs_recompute_business", { p_business_id: businessId });
  if (error) throw error;
  return data as CsHealthSnapshot;
}

export type HealthSettings = {
  singleton: boolean;
  login_green_days: number;
  login_yellow_days: number;
  login_red_days: number;
  sales_green_days: number;
  sales_mid_days: number;
  sales_window_days: number;
  products_stale_days: number;
  adoption_active_days: number;
  renewal_healthy_days: number;
  renewal_window_days: number;
  band_green_min: number;
  band_yellow_min: number;
  warning_no_sales_days: number;
  updated_at: string;
};

export type HealthSettingsUpdate = Partial<Omit<HealthSettings, "singleton" | "updated_at">>;

export async function getHealthSettings(): Promise<HealthSettings | null> {
  const { data, error } = await supabase.from("cs_settings").select("*").maybeSingle();
  if (error) throw error;
  return (data ?? null) as HealthSettings | null;
}

export async function updateHealthSettings(patch: HealthSettingsUpdate): Promise<HealthSettings> {
  const { data, error } = await supabase
    .from("cs_settings")
    .update(patch)
    .eq("singleton", true)
    .select()
    .single();
  if (error) throw error;
  return data as HealthSettings;
}
