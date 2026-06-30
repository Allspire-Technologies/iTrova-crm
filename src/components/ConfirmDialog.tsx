import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  busy?: boolean;
  /** When set, the user must type this exactly to enable the confirm button. */
  confirmPhrase?: string;
  onConfirm: () => void;
};

/** Lightweight, accessible confirmation modal for destructive actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  busy = false,
  confirmPhrase,
  onConfirm,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");

  const phraseRequired = !!confirmPhrase;
  const phraseOk = !phraseRequired || typed.trim() === confirmPhrase!.trim();
  const canConfirm = !busy && phraseOk;

  useEffect(() => {
    if (!open) return;
    setTyped(""); // reset each time it opens
    (phraseRequired ? inputRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, phraseRequired, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={() => !busy && onOpenChange(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="font-display text-lg font-semibold text-brand-dark">{title}</h2>
        {description && <div className="mt-2 text-sm text-muted-foreground">{description}</div>}

        {phraseRequired && (
          <div className="mt-4 space-y-1.5">
            <label htmlFor="confirm-phrase" className="block text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{confirmPhrase}</span> to confirm
            </label>
            <Input
              id="confirm-phrase"
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canConfirm) onConfirm(); }}
              placeholder={confirmPhrase}
              autoComplete="off"
              aria-label={`Type ${confirmPhrase} to confirm`}
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{cancelLabel}</Button>
          <Button
            ref={confirmRef}
            variant={variant === "danger" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
