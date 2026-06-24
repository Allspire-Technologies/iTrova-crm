import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { ReactNode } from "react";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-secondary text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="font-display font-semibold text-brand-dark">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
