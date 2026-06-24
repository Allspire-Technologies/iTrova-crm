import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 font-display text-2xl font-bold text-brand-dark">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-brand">
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}
