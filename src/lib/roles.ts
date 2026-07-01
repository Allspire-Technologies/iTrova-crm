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
// Changing a business's plan (dual-control) is Management/Admin-only (§3). DB is the real gate.
export const roleCanManagePlans = (role: StaffRole | null) => role === "admin";

export async function getMyRole(): Promise<StaffRole | null> {
  const { data, error } = await supabase.rpc("cs_my_role");
  if (error) throw error;
  return (data as StaffRole | null) ?? null;
}

export type StaffWithRole = { userId: string; name: string | null; email: string | null; role: StaffRole; pending: boolean };

export async function listStaffRoles(): Promise<StaffWithRole[]> {
  const { data, error } = await supabase.rpc("admin_list_staff_roles");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: String(r.user_id),
    name: r.name == null ? null : String(r.name),
    email: r.email == null ? null : String(r.email),
    role: String(r.role) as StaffRole,
    pending: r.pending === true,
  }));
}

export async function setStaffRole(userId: string, role: StaffRole): Promise<void> {
  const { error } = await supabase.from("cs_staff_role").upsert({ user_id: userId, role }, { onConflict: "user_id" });
  if (error) throw error;
}

/** Revoke a staff member's Admin OS access (admin only; can't remove yourself). */
export async function removeStaff(userId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_remove_staff", { p_user_id: userId });
  if (error) throw error;
}

/** Generate a staff invite link (admin only). The admin copies it to the new staff member, who
 *  opens it and sets their name + password on /set-password. The Edge Function (service-role,
 *  server-side) returns a token; we build the link on OUR domain so the URL never shows Supabase. */
export async function inviteStaff(email: string, role: StaffRole): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ token_hash?: string; type?: string; error?: string }>(
    "invite-staff",
    { body: { email: email.trim(), role } },
  );
  if (error) {
    // Function unreachable (not deployed / not served locally).
    if ((error as { name?: string }).name === "FunctionsFetchError" || /failed to send a request/i.test(error.message)) {
      throw new Error("Couldn't reach the invite function — deploy it: supabase functions deploy invite-staff");
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
  if (!data?.token_hash) throw new Error("No invite token was returned.");
  const params = new URLSearchParams({ token_hash: data.token_hash, type: data.type ?? "invite" });
  return `${window.location.origin}/set-password?${params.toString()}`;
}
