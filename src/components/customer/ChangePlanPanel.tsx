import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { formatMoney } from "@/lib/format";
import {
  listPlans,
  getActivePlanChange,
  requestPlanChange,
  approvePlanChange,
  cancelPlanChange,
  executePlanChange,
  type PlanCatalogItem,
  type PlanChangeRequest,
} from "@/lib/plans";

const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CYCLE_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  biannual: "Biannual",
  annual: "Annual",
};
const cycleLabel = (c: string) => CYCLE_LABELS[c] ?? cap(c);

// Net price after the per-cycle discount. plan_prices_view.price_amount is the list price and
// discount_percent the reduction, so show what the business actually pays.
function netPrice(p: PlanCatalogItem) {
  if (p.priceAmount == null) return null;
  const pct = p.discountPercent ?? 0;
  return pct > 0 ? Math.round(p.priceAmount * (1 - pct / 100)) : p.priceAmount;
}

// Rows are already filtered to one cycle, so show tier + the discounted per-cycle price.
function planLabel(p: PlanCatalogItem, currency: string) {
  const name = p.planName ?? cap(p.planKey);
  const net = netPrice(p);
  if (net == null) return name;
  const off = p.discountPercent && p.discountPercent > 0 ? ` (${p.discountPercent}% off)` : "";
  return `${name} — ${formatMoney(net, currency)}${off}`;
}

const selectClass =
  "h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Dual-control plan change (Management/Admin only — gated by the caller). One admin requests a
 * change; a DIFFERENT admin generates a one-time code; the requester applies it with password +
 * code. All authorization is enforced server-side (RPCs + the execute-plan-change Edge Function).
 */
export function ChangePlanPanel({
  businessId,
  currentTier,
  currentCycle,
  currency,
  onChanged,
}: {
  businessId: string;
  currentTier: string | null;
  currentCycle: string | null;
  currency: string;
  onChanged: () => void;
}) {
  const myId = useAuth().user?.id ?? null;
  const [req, setReq] = useState<PlanChangeRequest | null | undefined>(undefined); // undefined = loading
  const [plans, setPlans] = useState<PlanCatalogItem[]>([]);
  const [cycle, setCycle] = useState<string>(currentCycle ?? "");
  const [target, setTarget] = useState(currentTier ?? "");
  const [busy, setBusy] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReq(undefined);
    getActivePlanChange(businessId)
      .then((r) => !cancelled && setReq(r))
      .catch(() => !cancelled && setReq(null));
    return () => {
      cancelled = true;
    };
  }, [businessId, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    listPlans()
      .then((p) => !cancelled && setPlans(p))
      .catch(() => {
        /* dropdown just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // iTrova prices per cycle, so each cycle is its own set of plan rows. Offer the cycles that exist
  // in the catalogue, then the plans within the chosen cycle.
  const cycleOptions = Array.from(new Set(plans.map((p) => p.cycle).filter(Boolean)));
  const plansForCycle = plans.filter((p) => p.cycle === cycle);

  // Once plans load, settle the cycle on the current cycle (else the first available).
  useEffect(() => {
    if (cycleOptions.length === 0) return;
    setCycle((prev) =>
      prev && cycleOptions.includes(prev) ? prev : currentCycle && cycleOptions.includes(currentCycle) ? currentCycle : cycleOptions[0],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans]);

  // Keep the selected plan valid for the chosen cycle (prefer the current plan when it's offered).
  useEffect(() => {
    const inCycle = plans.filter((p) => p.cycle === cycle);
    setTarget((prev) =>
      inCycle.some((p) => p.planKey === prev)
        ? prev
        : inCycle.some((p) => p.planKey === currentTier)
          ? currentTier ?? ""
          : inCycle[0]?.planKey ?? "",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle, plans]);

  const reload = () => {
    setGeneratedCode(null);
    setReloadKey((k) => k + 1);
  };

  const isRenewal = target === currentTier && cycle === currentCycle;

  async function onRequest() {
    if (!target) return;
    setBusy(true);
    try {
      await requestPlanChange(businessId, target, cycle);
      toast.success(`Plan ${isRenewal ? "renewal" : "change"} requested — ask another admin to approve it.`);
      reload();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't request the change."));
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    if (!req) return;
    setBusy(true);
    try {
      const c = await approvePlanChange(req.id);
      setGeneratedCode(c);
      setReq({ ...req, status: "approved", approvedBy: myId }); // keep the code on screen
      toast.success("Approved — share the code with the requester.");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't approve the change."));
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!req) return;
    setBusy(true);
    try {
      await executePlanChange(req.id, password, code);
      toast.success("Plan updated.");
      setPassword("");
      setCode("");
      onChanged();
      reload();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't apply the change."));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!req) return;
    setBusy(true);
    try {
      await cancelPlanChange(req.id);
      toast.success("Request canceled.");
      reload();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't cancel the request."));
    } finally {
      setBusy(false);
    }
  }

  if (req === undefined) {
    return <p className="mt-5 border-t border-border/60 pt-4 text-xs text-muted-foreground">Loading plan controls…</p>;
  }

  const iAmRequester = !!req && req.requestedBy === myId;

  return (
    <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="size-3.5" /> Change or renew plan
      </p>

      {/* No in-flight request → pick a cycle, then a plan (priced for that cycle). */}
      {!req && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Billing cycle" value={cycle} onChange={(e) => setCycle(e.target.value)} className={selectClass}>
              {cycleOptions.length === 0 && <option value="">Cycle…</option>}
              {cycleOptions.map((c) => (
                <option key={c} value={c}>
                  {cycleLabel(c)}
                </option>
              ))}
            </select>
            <select aria-label="Target plan" value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass}>
              {plansForCycle.length === 0 && <option value="">No plans for this cycle</option>}
              {plansForCycle.map((p) => (
                <option key={p.planKey} value={p.planKey}>
                  {planLabel(p, currency)}
                  {p.planKey === currentTier && cycle === currentCycle ? " (current)" : ""}
                </option>
              ))}
            </select>
            <Button variant="brand" size="sm" disabled={!target || busy} onClick={onRequest}>
              {isRenewal ? "Request renewal" : "Request change"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Pick the billing cycle then the plan, or keep the current plan to renew (restart the period). A second
            admin must approve before it can be applied.
          </p>
        </>
      )}

      {/* An in-flight request exists. */}
      {req && (
        <div className="space-y-3">
          <p className="text-sm text-brand-dark">
            Pending: <span className="font-medium capitalize">{req.fromTier ?? "—"}</span>
            {req.fromCycle ? ` (${req.fromCycle})` : ""} →{" "}
            <span className="font-medium capitalize">{req.toTier}</span>
            {req.toCycle ? ` (${req.toCycle})` : ""}
          </p>

          {/* Approver just generated a code — show it so they can hand it over. */}
          {generatedCode && (
            <div className="rounded-lg border border-brand/40 bg-brand-light/30 p-3">
              <p className="text-xs text-muted-foreground">
                Share this one-time code with {req.requestedByName ?? "the requester"} (expires in 15 minutes):
              </p>
              <p className="mt-1 font-display text-2xl font-bold tracking-[0.3em] text-brand-dark" aria-label="Approval code">
                {generatedCode}
              </p>
            </div>
          )}

          {/* Pending, viewer is a DIFFERENT admin → can approve + mint a code. */}
          {req.status === "pending" && !iAmRequester && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Requested by {req.requestedByName ?? "another admin"}.</span>
              <Button variant="brand" size="sm" disabled={busy} onClick={onApprove}>
                <KeyRound className="size-3.5" /> Generate approval code
              </Button>
            </div>
          )}

          {/* Pending, viewer is the requester → wait for someone else. */}
          {req.status === "pending" && iAmRequester && (
            <p className="text-xs text-muted-foreground">Waiting for another admin to approve this request.</p>
          )}

          {/* Approved, viewer is the requester → enter password + code to apply. */}
          {req.status === "approved" && iAmRequester && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Enter your password and the code from {req.approvedByName ?? "the approving admin"} to apply.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  aria-label="Your password"
                  autoComplete="current-password"
                  className="max-w-[200px]"
                />
                <Input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                  aria-label="Approval code"
                  className="max-w-[140px]"
                />
                <Button variant="brand" size="sm" disabled={busy || !password || !code} onClick={onApply}>
                  Apply change
                </Button>
              </div>
            </div>
          )}

          {/* Approved, viewer is not the requester → waiting on the requester. */}
          {req.status === "approved" && !iAmRequester && (
            <p className="text-xs text-muted-foreground">
              Approved — waiting for {req.requestedByName ?? "the requester"} to apply.
            </p>
          )}

          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" disabled={busy} onClick={onCancel}>
            Cancel request
          </Button>
        </div>
      )}
    </div>
  );
}
