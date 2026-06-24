import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LoadingState } from "@/components/states/LoadingState";

/**
 * Staff-only gate. Only internal users (rows in platform_admins, surfaced via the
 * is_platform_admin() RPC) may enter Admin OS. Anyone else is redirected:
 *  - no session            -> /login
 *  - signed in, not staff  -> /no-access (a customer hitting Admin OS)
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const { user, loading, isStaff } = useAuth();

  if (loading) return <LoadingState full label="Loading…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (isStaff === null) return <LoadingState full label="Checking access…" />;
  if (!isStaff) return <Navigate to="/no-access" replace />;

  return <>{children}</>;
}
