import { ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

// Shared accessible shell for CMS editor dialogs: labelled dialog semantics, Escape closes,
// first enabled field focused on open, Tab trapped inside, focus restored on close.
// Click-outside still closes. The close handler lives in a ref so a parent that recreates it
// on every render never re-triggers the mount-only focus logic.
export function EditorShell({
  title,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const FOCUSABLE =
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    ref.current
      ?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")
      ?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onCloseRef.current();
      if (e.key !== "Tab") return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const inside = !!active && !!ref.current?.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "max-h-[90vh] w-full space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-5",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="font-display text-lg font-semibold text-brand-dark">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

export function PublishedPill({ on, offLabel = "Draft" }: { on: boolean; offLabel?: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        on ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground",
      )}
    >
      {on ? "Published" : offLabel}
    </span>
  );
}
