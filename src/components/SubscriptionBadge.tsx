import { Badge } from "@/components/ui/badge";
import type { SubscriptionStatus } from "@/lib/customers";

const STATUS: Record<SubscriptionStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  trialing: { label: "Trialing", variant: "secondary" },
  past_due: { label: "Past due", variant: "destructive" },
  canceled: { label: "Canceled", variant: "outline" },
  expired: { label: "Expired", variant: "outline" },
};

export function SubscriptionBadge({ status }: { status: SubscriptionStatus | null }) {
  if (!status) return <Badge variant="outline">No subscription</Badge>;
  const s = STATUS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function PlanBadge({ planKey }: { planKey: string | null }) {
  if (!planKey) return <span className="text-muted-foreground">—</span>;
  return <Badge variant="secondary" className="capitalize">{planKey}</Badge>;
}
