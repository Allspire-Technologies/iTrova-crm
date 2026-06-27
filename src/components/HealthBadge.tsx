import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HealthBand } from "@/lib/cs";

// Status pill for the customer health band (PRD §7.2): a colored pill WITH a text label.
// green → Healthy, yellow → Warning, red → Critical. Semantic colors are intentionally
// explicit (emerald/amber/red) rather than brand tokens so the band reads at a glance.
const BAND: Record<HealthBand, { label: string; pill: string; dot: string }> = {
  green: { label: "Healthy", pill: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  yellow: { label: "Warning", pill: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
  red: { label: "Critical", pill: "bg-red-100 text-red-700", dot: "bg-red-500" },
};

export function HealthBadge({ band, score }: { band: HealthBand | null; score?: number | null }) {
  if (!band) return <span className="text-muted-foreground">—</span>;
  const b = BAND[band];
  return (
    <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap border-transparent", b.pill)}>
      <span className={cn("size-1.5 rounded-full", b.dot)} aria-hidden />
      {b.label}
      {score != null && <span className="tabular-nums opacity-70">· {score}</span>}
    </Badge>
  );
}
