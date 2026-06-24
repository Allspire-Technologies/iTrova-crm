import { Loader2 } from "lucide-react";

export function LoadingState({ label = "Loading…", full = false }: { label?: string; full?: boolean }) {
  return (
    <div className={`grid place-items-center text-center ${full ? "min-h-screen" : "py-20"}`}>
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="size-7 animate-spin text-brand" />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  );
}
