import { supabase } from "@/integrations/supabase/client";

// Staff roles (PRD §3). The DB (RLS + cs_can_write) is the source of truth; the helpers below
// mirror it only to drive UI gating (hide/disable controls the user can't use anyway).

export type StaffRole = "admin" | "cso" | "pm" | "support";

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Management / Admin",
  cso: "Customer Success Officer",
  pm: "Product Manager",
  support: "Support Team",
};

export const STAFF_ROLES: StaffRole[] = ["admin", "cso", "pm", "support"];

// Mirror of cs_role_can_write. Areas only admins may write are gated separately.
const WRITE: Record<StaffRole, ReadonlySet<string>> = {
  admin: new Set(),
  cso: new Set(["notes", "tickets", "tasks", "pipeline", "feedback", "alerts"]),
  pm: new Set(["features", "notes", "feedback", "alerts"]),
  support: new Set(["tickets", "notes", "feedback", "alerts"]),
};
const ADMIN_ONLY = new Set(["settings", "assignment", "roles"]);

export function roleCanWrite(role: StaffRole | null, area: string): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  if (ADMIN_ONLY.has(area)) return false;
  return WRITE[role].has(area);
}

export const roleSeesRevenue = (role: StaffRole | null) => role === "admin";
export const roleSeesAll = (role: StaffRole | null) => role === "admin" || role === "cso" || role === "pm";

export async function getMyRole(): Promise<StaffRole | null> {
  const { data, error } = await supabase.rpc("cs_my_role");
  if (error) throw error;
  return (data as StaffRole | null) ?? null;
}

export type StaffWithRole = { userId: string; name: string | null; email: string | null; role: StaffRole };

export async function listStaffRoles(): Promise<StaffWithRole[]> {
  const { data, error } = await supabase.rpc("admin_list_staff_roles");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: String(r.user_id),
    name: r.name == null ? null : String(r.name),
    email: r.email == null ? null : String(r.email),
    role: String(r.role) as StaffRole,
  }));
}

export async function setStaffRole(userId: string, role: StaffRole): Promise<void> {
  const { error } = await supabase.from("cs_staff_role").upsert({ user_id: userId, role }, { onConflict: "user_id" });
  if (error) throw error;
}
