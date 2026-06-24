import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center p-6 bg-gradient-soft text-center">
      <div className="space-y-3">
        <h1 className="font-display text-5xl font-bold text-brand-dark">404</h1>
        <p className="text-muted-foreground">This page doesn't exist in Admin OS.</p>
        <Button asChild variant="outline"><Link to="/">Back to dashboard</Link></Button>
      </div>
    </main>
  );
}
