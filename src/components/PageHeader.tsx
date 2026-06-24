import { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold text-brand-dark">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1 text-sm md:text-base">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
