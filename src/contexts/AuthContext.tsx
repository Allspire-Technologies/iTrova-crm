import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole, type StaffRole } from "@/lib/roles";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** null = not yet determined; false = signed in but not internal staff. */
  isStaff: boolean | null;
  /** The staff member's role (PRD §3), or null until known / not staff. */
  role: StaffRole | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Staff check: a SECURITY DEFINER RPC in the shared iTrova DB that returns true only
  // for rows in platform_admins. No new auth system — this rides on Supabase Auth.
  useEffect(() => {
    if (!user) { setIsStaff(null); setRole(null); return; }
    let cancelled = false;
    setIsStaff(null);
    setRole(null);
    supabase.rpc("is_platform_admin").then(({ data, error }) => {
      if (cancelled) return;
      const staff = !error && data === true;
      setIsStaff(staff);
      if (staff) getMyRole().then((r) => !cancelled && setRole(r)).catch(() => !cancelled && setRole(null));
    });
    return () => { cancelled = true; };
  }, [user]);

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <AuthContext.Provider value={{ user, session, loading, isStaff, role, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
