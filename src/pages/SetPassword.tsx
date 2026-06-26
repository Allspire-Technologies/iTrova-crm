import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import type { EmailOtpType } from "@supabase/supabase-js";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/states/LoadingState";

// Defined at module scope so it keeps a stable component identity across re-renders — otherwise
// the inputs remount on every keystroke and lose focus.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-hero p-6">
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-background p-8 shadow-elevated">
        <div className="flex items-center gap-2 font-display text-2xl font-bold text-brand-dark">
          <div className="grid size-10 place-items-center rounded-xl bg-gradient-brand text-brand-foreground">
            <ShieldCheck className="size-5" />
          </div>
          iTrova Admin OS
        </div>
        {children}
      </div>
    </main>
  );
}

// Landing page for an invited staff member. The invite link (on our own domain) carries a
// token_hash; we verify it here (verifyOtp) to establish the session, then they set name + password.
export default function SetPassword() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verified = useRef(false);

  // Exchange the invite token for a session (once).
  useEffect(() => {
    const tokenHash = params.get("token_hash");
    const type = (params.get("type") as EmailOtpType) || "invite";
    if (!tokenHash || user || verified.current) return;
    verified.current = true;
    setVerifying(true);
    supabase.auth
      .verifyOtp({ type, token_hash: tokenHash })
      .then(({ error }) => {
        if (error) setVerifyError(error.message);
      })
      .finally(() => setVerifying(false));
  }, [params, user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password, data: { full_name: name.trim() } });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome to Admin OS — your account is ready.");
    navigate("/", { replace: true });
  }

  if (loading || verifying) {
    return (
      <Shell>
        <LoadingState label="Verifying your invite…" />
      </Shell>
    );
  }

  if (verifyError) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          This invite link is invalid or has expired. Ask an admin to send you a new one, or{" "}
          <Link to="/login" className="text-brand underline-offset-2 hover:underline">sign in</Link>.
        </p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          This page is for setting up an invited account. Please open it from your invite link, or{" "}
          <Link to="/login" className="text-brand underline-offset-2 hover:underline">sign in</Link>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-1">
        <h1 className="font-display text-lg font-semibold text-brand-dark">Set your password</h1>
        <p className="text-sm text-muted-foreground">Welcome{user.email ? `, ${user.email}` : ""}. Choose a name and password to finish.</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="sn" className="text-sm font-medium">Your name</label>
          <Input id="sn" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Obi" />
        </div>
        <div className="space-y-2">
          <label htmlFor="sp" className="text-sm font-medium">New password</label>
          <Input id="sp" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
        <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy || !name.trim() || password.length < 8}>
          {busy ? "Saving…" : "Set password & continue"}
        </Button>
      </form>
    </Shell>
  );
}
