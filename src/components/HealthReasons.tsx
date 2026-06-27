import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseHealthReasons, type FactorTone, type HealthFlagKind } from "@/lib/healthReasons";

// Presentable health breakdown for the customer Profile card. Renders the score's five signals
// as labelled rows with a points pill + progress bar, and surfaces trip-wires/warnings as
// "Needs attention" chips — instead of dumping the raw reasons JSON. Colors mirror HealthBadge
// (emerald / amber / red) so a row reads at a glance.

const TONE: Record<FactorTone, { pill: string; bar: string }> = {
  good: { pill: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-500" },
  warn: { pill: "bg-amber-100 text-amber-900", bar: "bg-amber-500" },
  bad: { pill: "bg-red-100 text-red-700", bar: "bg-red-400" },
};

const FLAG: Record<HealthFlagKind, { box: string; icon: typeof Info }> = {
  critical: { box: "bg-red-50 text-red-700", icon: AlertOctagon },
  warning: { box: "bg-amber-50 text-amber-900", icon: AlertTriangle },
  note: { box: "bg-muted text-foreground", icon: Info },
};

export function HealthReasons({ reasons }: { reasons: unknown }) {
  const { factors, flags, total, max } = parseHealthReasons(reasons);
  if (!factors.length && !flags.length) return null;

  return (
    <section className="mt-5 border-t border-border/60 pt-4" aria-label="Health breakdown">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Health breakdown</p>
        {max > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{total}</span>
            <span className="tabular-nums"> / {max} pts</span>
          </p>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">How this customer’s score splits across the signals we track.</p>

      {flags.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {flags.map((f, i) => {
            const Icon = FLAG[f.kind].icon;
            return (
              <li key={i} className={cn("flex items-start gap-2 rounded-md px-2.5 py-1.5 text-sm", FLAG[f.kind].box)}>
                <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{f.text}</span>
              </li>
            );
          })}
        </ul>
      )}

      {factors.length > 0 && (
        <ul className="mt-3 space-y-3">
          {factors.map((f) => (
            <li key={f.key} className="space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none text-foreground">{f.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", TONE[f.tone].pill)}>
                  {f.points}/{f.max}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
                <div
                  className={cn("h-full rounded-full transition-all", TONE[f.tone].bar)}
                  style={{ width: `${Math.max(0, Math.min(100, (f.points / f.max) * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
