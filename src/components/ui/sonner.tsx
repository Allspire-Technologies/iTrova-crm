import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "group rounded-xl border border-border bg-card text-card-foreground shadow-elevated",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
