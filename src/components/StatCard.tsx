import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  to?: string;
}) {
  const card = (
    <Card className={to ? "h-full transition-colors hover:border-brand/40 hover:bg-secondary/30" : "h-full"}>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 break-words font-display text-2xl font-bold text-brand-dark">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-brand">
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      {card}
    </Link>
  ) : (
    card
  );
}
