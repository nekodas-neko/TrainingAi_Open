"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Clock, TrendingDown, Pencil, Check, X, Trash2, ShieldCheck, SparklesIcon, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@trainingai/shared/utils";
import { hapticLight, hapticSuccess } from "@/lib/haptics";
import { invalidateProgramStructure, invalidateWorkoutSummaries } from "@/lib/cache-groups";

interface SetShape { sets: number; reps: number; pct: number; restSec: number }

interface ProposalExercise {
  sessionExerciseId: string;
  name: string;
  role: string;
  action: "keep" | "adjust" | "drop";
  before: SetShape | null;
  after: SetShape | null;
  reason: string | null;
  guardAdjusted: boolean;
}

interface ReviewResponse {
  sessionId: string;
  sessionName: string;
  totalBudgetMin: number;
  reasoning: string;
  confidence: number;
  proposal: {
    exercises: ProposalExercise[];
    projectedDurationMin: number;
    budgetMin: number;
    fitsBudget: boolean;
    weeklyImpact: Record<string, number>;
    droppedIds: string[];
    adjustedIds: string[];
    invalidIds: string[];
  };
}

// Per changed-row decision. Drops offer cycle / permanent / reject; adjusts offer cycle / reject.
type Decision = "cycle" | "permanent" | "reject";

interface Props {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}

function fmtShape(s: SetShape | null): string {
  return s ? `${s.sets}×${s.reps} @${s.pct}%` : "—";
}

export function WorkoutReviewSheet({ sessionId, open, onOpenChange, onApplied }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [applying, setApplying] = useState(false);

  const runReview = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/workout-review/session/${id}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Review failed — try again.");
        return;
      }
      const resp = body as ReviewResponse;
      setData(resp);
      // Default every proposed change to "this cycle".
      const init: Record<string, Decision> = {};
      for (const ex of resp.proposal.exercises) {
        if (ex.action !== "keep") init[ex.sessionExerciseId] = "cycle";
      }
      setDecisions(init);
    } catch {
      setError("Review failed — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && sessionId) runReview(sessionId);
  }, [open, sessionId, runReview]);

  // Actionable = drops/adjusts you decide on. Protected = exercises the AI wanted to drop but a
  // training-rule guard kept (e.g. it's your only work for an under-target muscle) — shown so the
  // reasoning matches the diff, but with nothing to decide. Kept = genuinely untouched.
  const actionable = data?.proposal.exercises.filter(e => e.action !== "keep") ?? [];
  const protectedRows = data?.proposal.exercises.filter(e => e.action === "keep" && e.guardAdjusted) ?? [];
  const keptCount = (data?.proposal.exercises.length ?? 0) - actionable.length - protectedRows.length;

  const setDecision = (id: string, d: Decision) => {
    hapticLight();
    setDecisions(prev => ({ ...prev, [id]: d }));
  };

  const selectedCount = actionable.filter(e => (decisions[e.sessionExerciseId] ?? "reject") !== "reject").length;

  async function apply() {
    if (!data || !sessionId) return;
    const adjustments: Array<SetShape & { sessionExerciseId: string }> = [];
    const dropThisCycle: string[] = [];
    const dropPermanent: string[] = [];
    for (const ex of actionable) {
      const d = decisions[ex.sessionExerciseId] ?? "reject";
      if (d === "reject") continue;
      if (ex.action === "adjust" && ex.after) {
        adjustments.push({ sessionExerciseId: ex.sessionExerciseId, ...ex.after });
      } else if (ex.action === "drop") {
        (d === "permanent" ? dropPermanent : dropThisCycle).push(ex.sessionExerciseId);
      }
    }

    setApplying(true);
    try {
      const res = await fetch(`/api/workout-review/session/${sessionId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustments,
          dropThisCycle,
          dropPermanent,
          estimatedSessionDurationMin: data.proposal.projectedDurationMin,
          reasoning: data.reasoning,
          confidence: data.confidence,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't apply — try again.");
        return;
      }
      await Promise.all([invalidateProgramStructure(), invalidateWorkoutSummaries()]);
      hapticSuccess();
      toast.success("Workout updated");
      onApplied?.();
      onOpenChange(false);
    } catch {
      toast.error("Couldn't apply — check your connection.");
    } finally {
      setApplying(false);
    }
  }

  const proposal = data?.proposal;
  const warmupMin = data && proposal ? Math.max(0, data.totalBudgetMin - proposal.budgetMin) : 0;
  const planTotalMin = proposal ? warmupMin + proposal.projectedDurationMin : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88vh] rounded-t-3xl flex flex-col p-0 gap-0">
        <SheetHeader className="text-left flex-none border-b border-border/50">
          <SheetTitle className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 text-amber-400" />
            Review{data ? ` · ${data.sessionName}` : " workout"}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">Reviewing your session against your recent data…</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              {sessionId && (
                <Button variant="outline" onClick={() => runReview(sessionId)}>Try again</Button>
              )}
            </div>
          )}

          {proposal && data && !loading && (
            <div className="flex flex-col gap-4">
              {/* Duration summary — framed against the full session budget (warmup + working). */}
              <div className={cn("rounded-xl px-3 py-2.5", proposal.fitsBudget ? "bg-green-500/10" : "bg-amber-500/10")}>
                <div className={cn("flex items-center gap-2 text-sm font-semibold", proposal.fitsBudget ? "text-green-500" : "text-amber-500")}>
                  <Clock className="h-4 w-4 flex-none" />
                  <span>≈{planTotalMin} of {data.totalBudgetMin} min{proposal.fitsBudget ? " — fits" : " — still over"}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 pl-6">
                  ~{warmupMin} min warmup + {proposal.projectedDurationMin} min working (≤{proposal.budgetMin} min target — finishes earlier as your rest/sets beat the estimates)
                </p>
              </div>

              <p className="text-sm text-muted-foreground">{data.reasoning}</p>

              {/* Weekly-volume impact */}
              {Object.keys(proposal.weeklyImpact).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(proposal.weeklyImpact).map(([muscle, delta]) => (
                    <span
                      key={muscle}
                      className={cn(
                        "text-[11px] font-semibold px-2 py-0.5 rounded-full",
                        delta < 0 ? "bg-orange-500/15 text-orange-500" : "bg-sky-500/15 text-sky-500",
                      )}
                    >
                      {muscle} {delta > 0 ? "+" : ""}{delta} set{Math.abs(delta) === 1 ? "" : "s"}/wk
                    </span>
                  ))}
                </div>
              )}

              {actionable.length === 0 && protectedRows.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No changes recommended — this session already fits.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {actionable.map(ex => {
                    const d = decisions[ex.sessionExerciseId] ?? "reject";
                    const isDrop = ex.action === "drop";
                    return (
                      <div key={ex.sessionExerciseId} className="rounded-xl border border-border p-3">
                        <div className="flex items-start gap-2">
                          <span className={cn(
                            "flex-none mt-0.5 rounded-md p-1",
                            isDrop ? "bg-red-500/15 text-red-500" : "bg-blue-500/15 text-blue-500",
                          )}>
                            {isDrop ? <Trash2 className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-sm leading-tight truncate">{ex.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {isDrop
                                ? <>Drop{ex.before ? <> · was {fmtShape(ex.before)}</> : null}</>
                                : <>{fmtShape(ex.before)} → <span className="text-foreground font-medium">{fmtShape(ex.after)}</span></>}
                            </p>
                            {ex.reason && <p className="text-xs text-muted-foreground/80 mt-1">{ex.reason}</p>}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                          <DecisionButton active={d === "cycle"} onClick={() => setDecision(ex.sessionExerciseId, "cycle")}
                            icon={<Check className="h-3.5 w-3.5" />} label="This cycle" />
                          {isDrop && (
                            <DecisionButton active={d === "permanent"} onClick={() => setDecision(ex.sessionExerciseId, "permanent")}
                              icon={<TrendingDown className="h-3.5 w-3.5" />} label="Permanent" />
                          )}
                          <DecisionButton active={d === "reject"} onClick={() => setDecision(ex.sessionExerciseId, "reject")}
                            icon={<X className="h-3.5 w-3.5" />} label="Skip"
                            className={isDrop ? "" : "col-start-3"} />
                        </div>
                      </div>
                    );
                  })}

                  {/* Guard-protected: the AI wanted to drop these, but a training rule kept them. */}
                  {protectedRows.map(ex => (
                    <div key={ex.sessionExerciseId} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                      <div className="flex items-start gap-2">
                        <span className="flex-none mt-0.5 rounded-md p-1 bg-amber-500/15 text-amber-500">
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm leading-tight truncate">{ex.name}</p>
                          <p className="text-xs text-amber-500/90 mt-0.5">AI wanted to drop this — kept to protect your training</p>
                          {ex.reason && <p className="text-xs text-muted-foreground/80 mt-1">{ex.reason}</p>}
                        </div>
                      </div>
                    </div>
                  ))}

                  {keptCount > 0 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      {keptCount} exercise{keptCount === 1 ? "" : "s"} kept unchanged
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pinned footer — clears the gesture bar via SheetContent's baked pb-safe-action. */}
        {proposal && !loading && (
          <div className="flex-none flex gap-2 px-4 pt-3 border-t border-border/60">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={applying}>
              Cancel
            </Button>
            {actionable.length > 0 && (
              <Button className="flex-1" onClick={apply} disabled={applying || selectedCount === 0}>
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : `Apply ${selectedCount || ""}`.trim()}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DecisionButton({ active, onClick, icon, label, className }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold transition active:scale-95 border min-h-[44px]",
        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
        className,
      )}
    >
      {icon} {label}
    </button>
  );
}
