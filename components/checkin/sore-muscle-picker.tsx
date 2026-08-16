"use client"

import { memo, useMemo } from "react"
import { MuscleHeatmap } from "@/components/muscle-heatmap"
import { computePerExerciseDeload, type PerExerciseDeloadInput } from "@trainingai/shared/ai-periodization/per-exercise-deload"

// Grouped so the pill column reads as anatomy rather than an alphabetical dump. Labels are the
// stored values (mood_logs.soreMuscles) — normalizeMuscle maps them onto heatmap slugs, so
// "Core" reaching the SVG as "abs" is handled there, not here.
export const SORE_MUSCLE_GROUPS: Array<{ label: string; muscles: string[] }> = [
  { label: "Upper", muscles: ["Chest", "Back", "Shoulders", "Biceps", "Triceps"] },
  { label: "Lower", muscles: ["Quads", "Hamstrings", "Glutes", "Calves"] },
  { label: "Core", muscles: ["Core"] },
]

interface Props {
  selected: string[]
  /** Muscles still under-recovered from recent training — auto-selected, and marked so the
   *  lifter can see which came from the log rather than from them. */
  suggested: string[]
  /** Muscles in today's session; a sore one here is what drives the per-exercise deload. */
  sessionMuscles?: string[]
  /** Per-exercise main/secondary muscle assignments for today's session (Q-115-followup) — lets
   *  the overlap banner predict computePerExerciseDeload's whole-session escalation instead of
   *  always promising a narrow "those exercises will be lightened" outcome. Omit to fall back to
   *  the narrow phrasing (matches the pre-Q-115-followup behaviour). */
  sessionExercises?: PerExerciseDeloadInput[]
  onToggle: (muscle: string) => void
}

export const SoreMusclePicker = memo(function SoreMusclePicker({
  selected, suggested, sessionMuscles, sessionExercises, onToggle,
}: Props) {
  const lower = (xs: string[]) => xs.map(x => x.toLowerCase())
  const sessionLower = lower(sessionMuscles ?? [])
  const overlapping = selected.filter(m => sessionLower.includes(m.toLowerCase()))

  // Mirrors computePerExerciseDeload's own escalation math exactly (>50% of session exercises
  // matched on a MAIN-role assignment → whole-session), reusing the shared function rather than
  // re-deriving it. trainingGoal/phase are fixed placeholders: neither affects the `outcome` this
  // reads (only the override numbers/notes this component doesn't use), and phase='deload' would
  // wrongly suppress the prediction, which the real deload-phase gate handles separately anyway.
  const willEscalateWholeSession = useMemo(() => {
    if (!sessionExercises?.length || overlapping.length === 0) return false
    return computePerExerciseDeload(sessionExercises, selected, 'strength', 'accumulation').outcome === 'whole_session'
  }, [sessionExercises, selected, overlapping.length])

  // MuscleHeatmap is memoized, and an inline .map() here minted a new array identity on every
  // render — so the SVG body map re-rendered on every unrelated state change in the mood
  // check-in sheet, including each keystroke in the notes field (PRF-13).
  const heatmapAssignments = useMemo(
    () => selected.map(m => ({ muscle: m, role: 'secondary' as const })),
    [selected],
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {/* Pills — left. The primary control, so it gets the width. */}
        <div className="min-w-0 flex-1 space-y-2.5">
          {SORE_MUSCLE_GROUPS.map(group => (
            <div key={group.label}>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.muscles.map(m => {
                  const isSelected = selected.includes(m)
                  const isSuggested = suggested.includes(m)
                  const inSession = sessionLower.includes(m.toLowerCase())
                  return (
                    <button
                      key={m}
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      onClick={() => onToggle(m)}
                      className="min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95"
                      style={{
                        borderColor: isSelected ? "var(--accent-amber)" : undefined,
                        background: isSelected
                          ? "color-mix(in oklch, var(--accent-amber) 16%, transparent)"
                          : undefined,
                        color: isSelected ? "var(--accent-amber)" : undefined,
                        // An auto-marked muscle that has been turned OFF keeps a dashed outline,
                        // so the lifter can see they overrode the log rather than the pill just
                        // looking untouched.
                        borderStyle: !isSelected && isSuggested ? "dashed" : undefined,
                      }}
                    >
                      {m}
                      {isSelected && isSuggested && (
                        <span className="ml-1 opacity-70" aria-label="not recovered from recent training">↻</span>
                      )}
                      {inSession && (
                        <span className="ml-1 opacity-60" aria-label="in today's session">•</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Body map — right. Read-only reflection of the pills.
            Passed as `secondary` assignments rather than muscleNames purely for COLOUR: that
            role paints amber, matching the selected pills, whereas muscleNames paints the
            "main" green and would show the same selection in two different colours. */}
        <div className="w-[38%] shrink-0" aria-hidden>
          <MuscleHeatmap
            assignments={heatmapAssignments}
            compact
            showEmptyHint={false}
          />
        </div>
      </div>

      {suggested.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span aria-hidden>↻</span> marks muscles still recovering from recent training — already
          counted as sore. Tap to remove any that feel fine.
        </p>
      )}

      {overlapping.length > 0 && (
        <div
          className="rounded-xl px-3 py-2 text-xs font-medium"
          style={{
            background: "color-mix(in oklch, var(--accent-amber) 12%, transparent)",
            color: "var(--accent-amber)",
          }}
        >
          {overlapping.join(" & ")} {overlapping.length === 1 ? "is" : "are"} sore and in today&apos;s
          session —{" "}
          {willEscalateWholeSession
            ? "over half the session is affected, so the whole session will be lightened, not just those exercises."
            : "those exercises will be lightened."}
        </div>
      )}
    </div>
  )
})
