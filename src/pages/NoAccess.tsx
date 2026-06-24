import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

export default function NoAccess() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const handleSignOut = async () => { await signOut(); navigate("/login", { replace: true }); };

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-gradient-soft">
      <div className="max-w-md text-center space-y-4 rounded-2xl bg-card border border-border/60 shadow-card p-10">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-warning/10 text-warning">
          <Lock className="size-6" />
        </div>
        <h1 className="font-display text-xl font-bold text-brand-dark">Staff access only</h1>
        <p className="text-sm text-muted-foreground">
          {user?.email ? <><span className="font-medium text-foreground">{user.email}</span> isn't an iTrova internal account. </> : null}
          Admin OS is restricted to iTrova staff. If you manage a business, use the iTrova app instead.
        </p>
        <Button variant="outline" onClick={handleSignOut}>Sign out</Button>
      </div>
    </main>
  );
}
