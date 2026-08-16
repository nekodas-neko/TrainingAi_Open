import type { ExerciseType } from "@trainingai/shared/types/program";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import { formatDateDisplay } from "@trainingai/shared/date-utils";

export const DEFAULT_SETS = 3;
export const DEFAULT_REPS = 8;
export const SET_COLORS = ["#f59e0b", "#22c55e", "#8b5cf6"] as const;

// Color for set index i. First three keep their long-standing identities; beyond
// that, golden-angle hue spacing yields visually distinct colors for any set count
// instead of the old i % 3 repetition.
export function setColor(i: number): string {
  if (i < SET_COLORS.length) return SET_COLORS[i];
  const hue = (i * 137.508) % 360;
  return `oklch(0.72 0.17 ${hue.toFixed(1)})`;
}

// Single-line "<weight> kg × <reps> reps" display, collapsing to "<reps> reps" for
// bodyweight exercises with no added/assisted load.
export function formatSetLoad(weight: number, reps: number, exerciseType?: ExerciseType): string {
  if (exerciseType === "bodyweight" && weight === 0) return `${reps} reps`;
  const weightStr = exerciseType === "bodyweight" && weight > 0 ? `+${weight}` : `${weight}`;
  return `${weightStr} kg × ${reps} reps`;
}

// Two-part "<weight label> / <reps label>" split for cards that style the weight and
// reps differently — weightLabel is null when there's nothing to show (bodyweight, no load).
export function formatSetLoadParts(weight: number, reps: number, exerciseType?: ExerciseType): { weightLabel: string | null; repsLabel: string } {
  if (exerciseType === "bodyweight" && weight === 0) {
    return { weightLabel: null, repsLabel: `${reps} reps` };
  }
  const weightStr = exerciseType === "bodyweight" && weight > 0 ? `+${weight} kg` : `${weight} kg`;
  return { weightLabel: weightStr, repsLabel: `× ${reps} reps` };
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatSheetDate(raw: string): string {
  return formatDateDisplay(raw, "short");
}

export function mround125(value: number): number {
  return Math.max(5, Math.min(250, Math.round(value / 1.25) * 1.25));
}

// Ceiling version: rounds UP to the nearest 1.25 kg.
// Used for prescription weights so that following the recommendation never
// drives the estimated 1RM downward — slight overload is better than underload.
export function mround125Up(value: number): number {
  return Math.max(5, Math.min(250, Math.ceil(value / 1.25) * 1.25));
}

// Barbell plates come in pairs, so the smallest real change on a bar is two
// plates — 2.5 kg with a 1.25 kg pair. Other equipment (dumbbells, cable
// stacks, machines) keeps the finer 1.25 kg default.
export const BARBELL_WEIGHT_STEP_KG = 2.5;
export const DEFAULT_WEIGHT_STEP_KG = 1.25;

export function weightStepFor(equipment?: string[] | null): number {
  return equipment?.includes("barbell") ? BARBELL_WEIGHT_STEP_KG : DEFAULT_WEIGHT_STEP_KG;
}

export function mroundStep(value: number, step: number): number {
  return Math.max(5, Math.min(250, Math.round(value / step) * step));
}

export function mroundStepUp(value: number, step: number): number {
  return Math.max(5, Math.min(250, Math.ceil(value / step) * step));
}

// Same formula used everywhere sets/reps are initialized for an exercise —
// progressionStyle's length is authoritative when present, else defaultSets.
export function exerciseSetCount(ex: { progressionStyle?: { reps: number }[] | null; defaultSets?: number | null }): number {
  return ex.progressionStyle ? ex.progressionStyle.length : (ex.defaultSets ?? DEFAULT_SETS);
}

export function defaultRpeFromPct(pct: number | undefined): number {
  if (pct === undefined) return 7
  return Math.min(10, Math.max(6, Math.floor(pct / 10)))
}

// Parse "80kg 5 reps", "5 reps 80", "80 by 5", "80 5" etc.
export function parseVoice(transcript: string): { weight?: number; reps?: number } {
  const t = transcript.toLowerCase()
    .replace(/kilograms?|kilos?|kgs?/g, 'kg')
    .replace(/reps?|repetitions?/g, 'reps')
    .replace(/\band\b/g, ' ')
    .replace(/[^0-9.\skgreps×x]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  let m: RegExpMatchArray | null

  m = t.match(/(\d+(?:\.\d+)?)\s*kg\s+(\d+)/)
  if (m) return { weight: parseFloat(m[1]), reps: parseInt(m[2]) }

  m = t.match(/(\d+)\s*reps\s+(\d+(?:\.\d+)?)/)
  if (m) return { reps: parseInt(m[1]), weight: parseFloat(m[2]) }

  m = t.match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+)/)
  if (m) return { weight: parseFloat(m[1]), reps: parseInt(m[2]) }

  m = t.match(/^(\d+)\s*reps?$/)
  if (m) return { reps: parseInt(m[1]) }

  m = t.match(/^(\d+(?:\.\d+)?)\s*kg$/)
  if (m) return { weight: parseFloat(m[1]) }

  m = t.match(/(\d+(?:\.\d+)?)\s+(\d+)/)
  if (m) return { weight: parseFloat(m[1]), reps: parseInt(m[2]) }

  return {}
}

// Clamps voice-recognised weight/reps to the same bounds the +/- controls and
// LogExercisePayloadSchema enforce — an unclamped mis-heard value (e.g. "0 reps",
// weight > 500) otherwise passes the local write but fails the server schema,
// quarantining as a poison mutation.
export function clampVoiceLogResult(weight?: number, reps?: number): { weight?: number; reps?: number } {
  return {
    weight: weight !== undefined ? Math.max(0, Math.min(500, weight)) : undefined,
    reps: reps !== undefined ? Math.max(1, Math.min(100, Math.round(reps))) : undefined,
  }
}

export const BAR_WEIGHT_KG = 20;
// One pair of each size — the plates available on the user's rack.
export const PLATE_PAIRS_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

// Reverts are a client-side overlay on the server prescription: the stored
// prescription stays deloaded, this swap only affects what the workout runs
// (and clears `deloaded` so the log payload and PR paths treat it as full).
export function applyDeloadReverts(
  exercises: WorkoutExercise[],
  revertedNames: string[],
): WorkoutExercise[] {
  if (revertedNames.length === 0) return exercises;
  return exercises.map(ex =>
    ex.deloaded && ex.preDeloadStyle && revertedNames.includes(ex.name)
      ? {
          ...ex,
          deloaded: false,
          deloadReverted: true,
          progressionStyle: ex.preDeloadStyle,
          defaultSets: ex.preDeloadSets ?? ex.defaultSets,
        }
      : ex,
  );
}

// Most-frequent weight across a set's logged weights — the representative "bar load"
// for a compact per-exercise summary. Returns null for an empty list.
export function modalWeight(weights: number[]): number | null {
  if (weights.length === 0) return null;
  const counts = new Map<number, number>();
  for (const w of weights) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best = weights[0], bestCount = 0;
  for (const w of weights) {
    const c = counts.get(w)!;
    if (c > bestCount) { best = w; bestCount = c; }
  }
  return best;
}

// Mean of the non-null reps across a set list; null when there are no reps.
// `rounding` collapses the fractional mean to an integer: 'round' (default) for
// "average" displays like the calendar day-detail; 'floor' for the pre-workout
// "last time" preview, where rounding up shows a rep count higher than all but
// one set achieved (e.g. 8,8,8,10 → "9"), which reads as inflated.
export function avgReps(reps: (number | null)[], rounding: 'round' | 'floor' = 'round'): number | null {
  const valid = reps.filter((r): r is number => r != null);
  if (valid.length === 0) return null;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  return rounding === 'floor' ? Math.floor(mean) : Math.round(mean);
}

export interface PlateBreakdown {
  perSide: number[];    // plates on each side, heaviest first
  achievableKg: number; // bar + 2 × sum(perSide); equals the target when exact
  exact: boolean;
}

// Greedy per-side breakdown. Returns null when the target is below the empty bar.
// Weights are 1.25 kg multiples but the per-side value can land on a 0.625 step,
// so a breakdown may be inexact — achievableKg is then the closest load below.
export function plateBreakdown(targetKg: number, barKg: number = BAR_WEIGHT_KG): PlateBreakdown | null {
  if (targetKg < barKg) return null;
  let remaining = (targetKg - barKg) / 2;
  const perSide: number[] = [];
  for (const plate of PLATE_PAIRS_KG) {
    if (remaining >= plate - 1e-9) {
      perSide.push(plate);
      remaining -= plate;
    }
  }
  const achievableKg = barKg + 2 * perSide.reduce((sum, p) => sum + p, 0);
  return { perSide, achievableKg, exact: Math.abs(achievableKg - targetKg) < 1e-9 };
}
