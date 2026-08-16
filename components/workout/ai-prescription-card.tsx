"use client";

import { useState } from "react";
import { useTransitionRouter } from "@/lib/view-transition";
import { toast } from "sonner";
import { CheckIcon, XIcon, SparklesIcon, ChevronDownIcon, ArrowRightIcon, PlusIcon, AlertTriangleIcon, BatteryLowIcon, TrendingUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@trainingai/shared/utils";
import type { AiPrescription, PrescriptionStatus, PeriodizationPhase } from "@trainingai/shared/types/ai-periodization";
import { LOW_CONFIDENCE_THRESHOLD } from "@trainingai/shared/ai-periodization/confidence";
import { explainExerciseChoice } from "@trainingai/shared/ai-periodization/explain";
import { mroundStepUp, weightStepFor } from "@/components/workout/utils";
import { intensityZoneForPct } from "@trainingai/shared/workout/intensity-zone";
import { RoleChip } from "./role-chip";
import { invalidatePrescriptionChanged } from "@/lib/cache-groups";

export interface ExerciseSignal {
  role: string;
  rm1Trend: 'up' | 'flat' | 'down';
  rm1ChangeKg: number;
}

interface AiPrescriptionCardProps {
  prescription: AiPrescription;
  prescriptionStatus: PrescriptionStatus;
  // Live estimated 1RM per session-exercise id — the same basis the bar loads from,
  // so the weight shown here matches what the workout actually prescribes.
  liveOneRm: Record<string, number | null>;
  // Per session-exercise id: how the last working set is pushed to grow 1RM.
  lastSetModeById?: Record<string, 'amrap' | 'plus1' | undefined>;
  // Per session-exercise id: equipment tags, so the displayed weight rounds to the same
  // step (2.5kg barbell vs 1.25kg default) the workout screen actually loads.
  equipmentById?: Record<string, string[] | undefined>;
  // Per session-exercise id: 'weighted' | 'bodyweight'. A bodyweight 1RM change in kg is a change
  // in an internal index, not in weight lifted, so the rationale must not quote it (Q-19).
  exerciseTypeById?: Record<string, string | undefined>;
  // Per session-exercise id: signals that shaped the choice (role, 1RM trend).
  exerciseSignalsById?: Record<string, ExerciseSignal | undefined>;
  sessionId: string;
  onStatusChange: (newStatus: PrescriptionStatus) => void;
  onPhaseChanged?: () => void;
}

export function AiPrescriptionCard({
  prescription,
  prescriptionStatus,
  liveOneRm,
  lastSetModeById,
  equipmentById,
  exerciseTypeById,
  exerciseSignalsById,
  sessionId,
  onStatusChange,
  onPhaseChanged,
}: AiPrescriptionCardProps) {
  const router = useTransitionRouter();
  const [expanded, setExpanded] = useState(prescriptionStatus === 'pending');
  const [showWhy, setShowWhy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmLow, setConfirmLow] = useState(false);

  const reasons = prescription.confidenceReasons ?? [];
  // Deload sessions report confidence 1.0 deterministically — never gate them.
  const isLowConfidence = !prescription.deload && prescription.confidence < LOW_CONFIDENCE_THRESHOLD;

  const isAutoApplied = prescriptionStatus === 'auto_applied';
  const isAccepted = prescriptionStatus === 'accepted';
  const isDismissed = prescriptionStatus === 'dismissed';
  const isPending = prescriptionStatus === 'pending';
  const isTransitionRecommended = prescription.phaseAction === 'transition_recommended';
  const isDeloadRecommended = prescription.phaseAction === 'deload_recommended';
  // A transition whose target is accumulation means the deload (recovery) block is done
  // and a fresh cycle is starting — offer building a new program as an alternative.
  const isCycleRestart = isTransitionRecommended && prescription.phase === 'accumulation';

  // Exercises dropped for this cycle are not part of today's session — workout-data filters
  // them out of what actually loads, so the card must not advertise them either (the
  // AiPrescription type states this contract). The reasoning text names what was dropped.
  const droppedIds = new Set(prescription.droppedExerciseIds ?? []);
  const shownExercises = prescription.exercises.filter(ex => !droppedIds.has(ex.sessionExerciseId));

  async function respond(action: 'accept' | 'dismiss') {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-periodization/session/${sessionId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        await invalidatePrescriptionChanged(sessionId);
        onStatusChange(data.prescriptionStatus);
      } else {
        toast.error("Couldn't save — try again");
      }
    } finally {
      setLoading(false);
    }
  }

  async function executeTransition(newPhase: PeriodizationPhase) {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-periodization/session/${sessionId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPhase }),
      });
      if (res.ok) {
        await invalidatePrescriptionChanged(sessionId);
        // Client-fired regeneration, same reliability reasoning as the open-time and
        // completion-time triggers in workout-screen.tsx. Fire-and-forget: the transition leaves
        // the slot in the pending state server-side, so the pre-workout poll recovers it if this
        // call is lost.
        fetch(`/api/ai-periodization/session/${sessionId}/prescribe`, { method: 'POST' })
          .then(r => { if (r.ok) invalidatePrescriptionChanged(sessionId).catch(() => {}); })
          .catch(() => {});
        onPhaseChanged?.();
      } else {
        toast.error("Couldn't start transition — try again");
      }
    } finally {
      setLoading(false);
    }
  }

  const phaseLabel: Record<string, string> = {
    accumulation: 'Accumulation',
    intensification: 'Intensification',
    realisation: 'Realisation',
    deload: 'Deload',
  };

  return (
    <div className={cn(
      "rounded-xl border px-4 py-3 space-y-2 transition-all",
      isDismissed ? "border-border/40 opacity-50" : "border-brand/30 bg-brand/8",
      (isAccepted || isAutoApplied) && "border-green-500/40 bg-green-500/8",
    )}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SparklesIcon className={cn(
            "h-4 w-4 flex-none",
            isDismissed ? "text-muted-foreground" : (isAccepted || isAutoApplied) ? "text-green-500" : "text-brand",
          )} />
          <div className="text-left min-w-0">
            <p className={cn(
              "text-sm font-semibold truncate",
              isDismissed ? "text-muted-foreground" : (isAccepted || isAutoApplied) ? "text-green-600 dark:text-green-400" : "text-brand",
            )}>
              AI Prescription · {phaseLabel[prescription.phase] ?? prescription.phase}
              {isAutoApplied && " · Auto-applied"}
              {isAccepted && " · Accepted"}
              {isDismissed && " · Dismissed"}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {prescription.deload ? "Deload session" : `Confidence ${Math.round(prescription.confidence * 100)}%`}
              {prescription.estimatedSessionDurationMin > 0 && ` · ~${prescription.estimatedSessionDurationMin} min`}
              {/* Once a transition has been APPLIED (auto or accepted) the action is history —
                  still calling it "suggested" would invite a tap on a decision already made. */}
              {isTransitionRecommended && (isPending
                ? " · Phase transition suggested"
                : ` · Moved to ${phaseLabel[prescription.phase] ?? prescription.phase}`)}
              {isDeloadRecommended && isPending && " · Deload recommended"}
            </p>
          </div>
        </div>
        <ChevronDownIcon className={cn("h-4 w-4 text-muted-foreground flex-none transition-transform", expanded && "rotate-180")} />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 pt-1 border-t border-brand/20">
          {/* An auto-applied transition changed the load without the lifter pressing anything,
              so its justification leads the card rather than sitting under the exercise list. */}
          {prescription.transitionRationale && (
            <div className="flex items-start gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-2">
              <TrendingUpIcon className="h-3.5 w-3.5 text-brand flex-none mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-brand">
                  Moved to {phaseLabel[prescription.phase] ?? prescription.phase}
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {prescription.transitionRationale}
                </p>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            {shownExercises.map(ex => {
              const oneRm = liveOneRm[ex.sessionExerciseId] ?? null;
              const weightKg = oneRm != null
                ? mroundStepUp(oneRm * ex.pct / 100, weightStepFor(equipmentById?.[ex.sessionExerciseId]))
                : null;
              const mode = lastSetModeById?.[ex.sessionExerciseId];
              const role = exerciseSignalsById?.[ex.sessionExerciseId]?.role;
              // Deload drops well below the working %, so the "band" would mislabel a light
              // recovery load as endurance — only annotate the zone on normal prescriptions.
              const zone = ex.deloaded ? null : intensityZoneForPct(ex.pct);
              return (
                <div key={ex.sessionExerciseId} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground font-medium truncate">{ex.name}</span>
                    <RoleChip role={role} className="!text-[9px] !px-1.5" />
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    {zone ? (
                      <span
                        className="inline-block flex-none rounded-full bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                        title={`${zone.range} of 1RM · typically ${zone.reps}`}
                      >
                        {zone.label} · {zone.range}
                      </span>
                    ) : <span />}
                    <span className="text-muted-foreground flex-none tabular-nums whitespace-nowrap">
                      {ex.sets}×{ex.reps}
                      {weightKg != null
                        ? ` @ ${weightKg}kg (${ex.pct}%)`
                        : ` @ ${ex.pct}%`
                      }
                      {" · "}{ex.restSec >= 60 ? `${Math.round(ex.restSec / 60)}min` : `${ex.restSec}s`} rest
                    </span>
                  </div>
                  {mode && (
                    <p className="text-[10px] text-brand/80 mt-0.5">
                      {mode === 'amrap'
                        ? `Last set: AMRAP — beat ${ex.reps} reps to grow your 1RM`
                        : `Last set: ${ex.reps + 1} reps (+1) to nudge your 1RM`}
                    </p>
                  )}
                  {ex.deloaded && (
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      <BatteryLowIcon className="h-3 w-3" />
                      {ex.deloadNote ?? "Deload"}
                    </p>
                  )}
                  {!ex.deloaded && ex.autoregNote && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{ex.autoregNote}</p>
                  )}
                </div>
              );
            })}
          </div>

          {prescription.reasoning && (
            <p className="text-[11px] text-muted-foreground italic border-t border-brand/10 pt-1.5">
              {prescription.reasoning}
            </p>
          )}

          {/* Per-muscle weekly volume this prescription contributes (sets/week), mirroring the
              workout-review sheet's weekly-impact pills — highest-volume muscles first. */}
          {Object.keys(prescription.weeklyVolumeContribution ?? {}).length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-brand/10 pt-1.5">
              {Object.entries(prescription.weeklyVolumeContribution)
                .sort((a, b) => b[1] - a[1])
                .map(([muscle, sets]) => (
                  <span key={muscle} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-500">
                    {muscle} {Math.round(sets * 10) / 10} set{sets === 1 ? "" : "s"}/wk
                  </span>
                ))}
            </div>
          )}

          <Collapsible open={showWhy} onOpenChange={setShowWhy} className="border-t border-brand/10 pt-1.5">
            <CollapsibleTrigger className="flex items-center gap-1 text-[11px] font-medium text-brand">
              <ChevronDownIcon className={cn("h-3 w-3 transition-transform", showWhy && "rotate-180")} />
              Why these reps/sets?
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1.5 space-y-2">
                {shownExercises.map(ex => {
                  const sig = exerciseSignalsById?.[ex.sessionExerciseId];
                  const bullets = explainExerciseChoice({
                    phase: prescription.phase,
                    role: sig?.role ?? 'primary',
                    rm1Trend: sig?.rm1Trend ?? 'flat',
                    rm1ChangeKg: sig?.rm1ChangeKg ?? 0,
                    lastSetMode: lastSetModeById?.[ex.sessionExerciseId],
                    exerciseType: exerciseTypeById?.[ex.sessionExerciseId],
                  });
                  return (
                    <div key={ex.sessionExerciseId}>
                      <p className="text-[11px] font-medium text-foreground">{ex.name}</p>
                      <ul className="list-disc pl-4 text-[10px] text-muted-foreground space-y-0.5">
                        {bullets.map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {!prescription.deload && reasons.length > 0 && (
            <div className="text-[10px] text-muted-foreground border-t border-brand/10 pt-1.5">
              <p className="font-medium mb-0.5">Why {Math.round(prescription.confidence * 100)}% confidence:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <p className="mt-1 italic">Confidence rises as you log more sessions of this type, morning check-ins, and recovery data (sleep / HRV).</p>
            </div>
          )}

          {isPending && (isTransitionRecommended || isDeloadRecommended) && (
            <div className="space-y-1.5 pt-1">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs border-orange-500/50 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10"
                  disabled={loading}
                  onClick={() => executeTransition(prescription.phase)}
                >
                  <ArrowRightIcon className="h-3.5 w-3.5 mr-1" />
                  {isCycleRestart ? 'Continue' : 'Move'} to {phaseLabel[prescription.phase] ?? prescription.phase}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  disabled={loading}
                  onClick={() => respond('dismiss')}
                >
                  <XIcon className="h-3.5 w-3.5 mr-1" />
                  Skip
                </Button>
              </div>
              {isCycleRestart && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full h-8 text-xs text-brand hover:bg-brand/10"
                  disabled={loading}
                  onClick={() => router.push('/config?new=program')}
                >
                  <PlusIcon className="h-3.5 w-3.5 mr-1" />
                  New program
                </Button>
              )}
            </div>
          )}
          {isPending && !isTransitionRecommended && !isDeloadRecommended && (
            <div className="space-y-1.5 pt-1">
              {isLowConfidence && (
                <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                  <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-500 flex-none mt-0.5" />
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Low confidence ({Math.round(prescription.confidence * 100)}%){reasons.length > 0 ? ' — see the factors above' : ''}. Review before applying.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    "flex-1 h-8 text-xs",
                    isLowConfidence && confirmLow
                      ? "border-red-500/60 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                      : "border-green-500/50 text-green-600 dark:text-green-400 hover:bg-green-500/10",
                  )}
                  disabled={loading}
                  onClick={() => {
                    if (isLowConfidence && !confirmLow) { setConfirmLow(true); return; }
                    respond('accept');
                  }}
                >
                  <CheckIcon className="h-3.5 w-3.5 mr-1" />
                  {isLowConfidence ? (confirmLow ? 'Confirm — apply anyway' : 'Apply anyway') : 'Accept'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 h-8 text-xs text-muted-foreground hover:text-foreground"
                  disabled={loading}
                  onClick={() => respond('dismiss')}
                >
                  <XIcon className="h-3.5 w-3.5 mr-1" />
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
