import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate("/", { replace: true });
  };

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-gradient-hero">
      <div className="w-full max-w-sm bg-background rounded-2xl shadow-elevated p-8 space-y-6">
        <div className="flex items-center gap-2 text-2xl font-display font-bold text-brand-dark">
          <div className="size-10 rounded-xl bg-gradient-brand grid place-items-center text-brand-foreground">
            <ShieldCheck className="size-5" />
          </div>
          iTrova Admin OS
        </div>
        <p className="text-sm text-muted-foreground">Internal staff sign in.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="le" className="text-sm font-medium">Email</label>
            <Input id="le" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@allspire.tech" />
          </div>
          <div className="space-y-2">
            <label htmlFor="lp" className="text-sm font-medium">Password</label>
            <Input id="lp" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
