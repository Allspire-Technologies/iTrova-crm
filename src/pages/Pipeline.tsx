import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, GripVertical, Pin, RefreshCw, Workflow } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { HealthBadge } from "@/components/HealthBadge";
import { getPipelineBoard, type PipelineCard } from "@/lib/admin";
import { pipeline } from "@/lib/cs";
import type { PipelineStage } from "@/lib/cs";
import { useAuth } from "@/contexts/AuthContext";
import { roleCanWrite } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "lead", label: "Lead" },
  { key: "registered", label: "Registered" },
  { key: "subscribed", label: "Subscribed" },
  { key: "onboarding", label: "Onboarding" },
  { key: "active", label: "Active" },
  { key: "power_user", label: "Power User" },
  { key: "renewed", label: "Renewed" },
  { key: "churned", label: "Churned" },
];

export default function Pipeline() {
  const navigate = useNavigate();
  const canMove = roleCanWrite(useAuth().role, "pipeline"); // CSO/Admin may move stages (§3)
  const [cards, setCards] = useState<PipelineCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCards(null);
    setError(null);
    getPipelineBoard()
      .then((c) => !cancelled && setCards(c))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load the pipeline."));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const byStage = useMemo(() => {
    const groups = new Map<PipelineStage, PipelineCard[]>(STAGES.map((s) => [s.key, []]));
    for (const c of cards ?? []) groups.get(c.stage)?.push(c);
    return groups;
  }, [cards]);

  async function move(businessId: string, to: PipelineStage) {
    const card = cards?.find((c) => c.businessId === businessId);
    if (!card || card.stage === to) return;
    const prev = cards ?? [];
    setCards((cs) => (cs ?? []).map((c) => (c.businessId === businessId ? { ...c, stage: to, stageSource: "manual" } : c)));
    try {
      await pipeline.set(businessId, to, "manual");
      toast.success(`Moved ${card.name} to ${STAGES.find((s) => s.key === to)?.label}.`);
    } catch (e) {
      setCards(prev);
      toast.error((e as { message?: string })?.message ?? "Couldn't move this business.");
    }
  }

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={canMove ? "Lifecycle stages auto-update nightly. Drag a card to pin it manually." : "Lifecycle stages auto-update nightly."}
        action={
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw /> Refresh
          </Button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : cards === null ? (
        <LoadingState label="Loading pipeline…" />
      ) : cards.length === 0 ? (
        <EmptyState icon={Workflow} title="No businesses yet" description="Businesses will appear here as they move through the lifecycle." />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((s) => {
            const items = byStage.get(s.key) ?? [];
            return (
              <div
                key={s.key}
                className={cn(
                  "flex w-72 shrink-0 flex-col rounded-xl border bg-secondary/30 transition-colors",
                  overStage === s.key ? "border-brand/50 bg-brand-light/30" : "border-border/60",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overStage !== s.key) setOverStage(s.key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((cur) => (cur === s.key ? null : cur));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  setOverStage(null);
                  setDragId(null);
                  if (id) move(id, s.key);
                }}
              >
                <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
                  <span className="text-sm font-semibold text-brand-dark">{s.label}</span>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">{items.length}</span>
                </div>

                <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
                  {items.map((c) => (
                    <div
                      key={c.businessId}
                      draggable={canMove}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", c.businessId);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(c.businessId);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      onClick={() => navigate(`/customers/${c.businessId}`)}
                      className={cn(
                        "group cursor-pointer rounded-lg border border-border/60 bg-card p-3 shadow-sm transition-all hover:border-brand/40 hover:shadow",
                        dragId === c.businessId && "opacity-50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-brand-dark">{c.name}</span>
                        {canMove && <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/50 group-hover:text-muted-foreground" />}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <HealthBadge band={c.healthBand} score={c.healthScore} />
                        {c.stageSource === "manual" && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Pinned manually — the nightly job won't move it">
                            <Pin className="size-3" /> Manual
                          </span>
                        )}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <div className="truncate">{c.accountManagerName ?? "Unassigned"}</div>
                        {c.renewalDate && (
                          <div className="flex items-center gap-1">
                            <CalendarClock className="size-3" /> Renews {formatDate(c.renewalDate)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
