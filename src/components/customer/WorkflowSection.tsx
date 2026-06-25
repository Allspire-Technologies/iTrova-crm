import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, CheckCircle2, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { useAuth } from "@/contexts/AuthContext";
import { listBusinessAlerts, acknowledgeAlert, resolveAlert, recomputeAlerts } from "@/lib/alerts";
import { recomputeHealth } from "@/lib/health";
import type { CsAlert, CsHealthSnapshot, AlertSeverity } from "@/lib/cs";
import { formatRelative } from "@/lib/format";

const SEVERITY: Record<AlertSeverity, "destructive" | "secondary"> = {
  critical: "destructive",
  warning: "secondary",
};

export function WorkflowSection({
  businessId,
  onHealthRecomputed,
}: {
  businessId: string;
  onHealthRecomputed?: (snapshot: CsHealthSnapshot) => void;
}) {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<CsAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // alert id or action key in flight
  const [recomputingHealth, setRecomputingHealth] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAlerts(null);
    setError(null);
    listBusinessAlerts(businessId)
      .then((a) => !cancelled && setAlerts(a))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load alerts."));
    return () => {
      cancelled = true;
    };
  }, [businessId, reloadKey]);

  async function onRecomputeHealth() {
    setRecomputingHealth(true);
    try {
      const snap = await recomputeHealth(businessId);
      onHealthRecomputed?.(snap);
      setReloadKey((k) => k + 1); // alerts may change with health
      toast.success(`Health recomputed: ${snap.score} (${snap.band}).`);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't recompute health.");
    } finally {
      setRecomputingHealth(false);
    }
  }

  async function onReevaluate() {
    setBusy("reeval");
    try {
      const next = await recomputeAlerts(businessId);
      setAlerts(next);
      toast.success("Alerts re-evaluated.");
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't re-evaluate alerts.");
    } finally {
      setBusy(null);
    }
  }

  async function onAck(id: string) {
    if (!user) return;
    setBusy(id);
    try {
      await acknowledgeAlert(id, user.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't acknowledge.");
    } finally {
      setBusy(null);
    }
  }

  async function onResolve(id: string) {
    setBusy(id);
    try {
      await resolveAlert(id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't resolve.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onRecomputeHealth} disabled={recomputingHealth}>
          <RefreshCw className={recomputingHealth ? "animate-spin" : undefined} /> Recompute health
        </Button>
        <Button size="sm" variant="ghost" onClick={onReevaluate} disabled={busy === "reeval"}>
          <BellRing /> Re-evaluate alerts
        </Button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !alerts ? (
        <LoadingState label="Loading alerts…" />
      ) : alerts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-card/50 px-4 py-6 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-600" /> No open alerts for this business.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
              <Badge variant={SEVERITY[a.severity]}>{a.severity}</Badge>
              <span className="font-medium capitalize text-brand-dark">{a.kind}</span>
              <span className="min-w-[8rem] flex-1 text-sm text-muted-foreground">{a.detail ?? "—"}</span>
              {a.status === "acknowledged" && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5" /> Acknowledged
                </span>
              )}
              <span className="text-xs text-muted-foreground">{formatRelative(a.created_at)}</span>
              {a.status === "active" && (
                <Button size="sm" variant="ghost" onClick={() => onAck(a.id)} disabled={busy === a.id}>
                  Acknowledge
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onResolve(a.id)} disabled={busy === a.id}>
                Resolve
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
