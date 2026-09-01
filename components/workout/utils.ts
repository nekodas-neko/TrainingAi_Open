import type { ExerciseType } from "@trainingai/shared/types/program";
import type { PhaseStatus } from "@trainingai/shared/workout/session-data";
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

// The example phrasing shown under the Voice button and named in its failure message. One string,
// so the hint and the error can never drift apart or from what the parser actually accepts.
export const VOICE_LOG_EXAMPLE = '60 kg 6 reps'

type VoiceToken =
  | { kind: 'number'; value: number }
  | { kind: 'kg' }
  | { kind: 'reps' }
  | { kind: 'sets' }

// A positive tokenizer, not a denylist. The old strip dropped every character outside
// `[0-9.\s kgreps×x]` — which keeps the `r` of `for` and the `es` of `times`, so `60 for 6` became
// `60 r 6` and matched no pattern while `60 by 6` (whose letters all vanish) worked. Nothing about
// the app told anyone which fillers were allowed. Pulling out only the tokens that mean something
// and ignoring every word between them makes each new phrasing work by construction rather than one
// stripped word at a time (BF-66). `x`/`×` need no token of their own: unmatched text is skipped, so
// `80 x 5` and `80x5` both reduce to two bare numbers, which is what the shorthand means anyway.
const VOICE_TOKEN_RE = /\d+(?:\.\d+)?|kilogram(?:me)?s?|kilos?|kgs?|repetitions?|reps?|sets?/g

function tokenizeVoice(transcript: string): VoiceToken[] {
  const tokens: VoiceToken[] = []
  for (const raw of transcript.toLowerCase().match(VOICE_TOKEN_RE) ?? []) {
    if (/^\d/.test(raw)) tokens.push({ kind: 'number', value: parseFloat(raw) })
    else if (raw.startsWith('k')) tokens.push({ kind: 'kg' })
    else if (raw.startsWith('s')) tokens.push({ kind: 'sets' })
    else tokens.push({ kind: 'reps' })
  }
  return tokens
}

// Parse "80kg 5 reps", "5 reps 80", "80 for 6", "60 times 6", "80 x 5", "80 5" etc.
export function parseVoice(transcript: string): { weight?: number; reps?: number } {
  const tokens = tokenizeVoice(transcript)

  let weight: number | undefined
  let reps: number | undefined
  const loose: number[] = []

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.kind !== 'number') continue
    const next = tokens[i + 1]?.kind
    if (next === 'kg') weight ??= tok.value
    else if (next === 'reps') reps ??= tok.value
    // "3 sets of 60 for 6" — the 3 is neither weight nor reps, and left loose it would take the
    // weight slot ahead of the 60.
    else if (next !== 'sets') loose.push(tok.value)
  }

  // Numbers no keyword claimed fill what is left, weight first — the order every shorthand uses
  // ("60 x 6", "60 for 6"). Beside a keyword a single loose number takes the empty slot, which is
  // what makes "5 reps 80" mean 80 kg. A lone bare number with no keyword at all fills nothing:
  // "60" is as likely to be reps as weight, and guessing wrong logs a wrong set silently.
  if (loose.length >= 2 || weight !== undefined || reps !== undefined) {
    for (const n of loose) {
      if (weight === undefined) weight = n
      else if (reps === undefined) reps = n
      else break
    }
  }

  return { ...(weight !== undefined && { weight }), ...(reps !== undefined && { reps }) }
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
/**
 * Whether the user has explicitly chosen `Full` over a deload prescription — the case where the
 * toggle's own word, **Override**, has to mean something (BF-64).
 *
 * **Keyed on the explicit choice, never on `deload === false`.** The choice state seeds `false` and
 * only adopts the prescription in an effect, so on first render `deload` is false while the
 * prescription is a deload and the user has chosen nothing. Keyed on `!deload`, a session-level
 * revert would paint full weights for a frame and then snap back.
 */
export function isFullOverride(chosen: boolean, prescribedDeload: boolean | undefined, deload: boolean): boolean {
  return chosen && prescribedDeload === true && deload === false
}

/**
 * The exercises to revert this render: the per-exercise reverts the user picked, plus — under a
 * session-level `Full` override — every deloaded exercise the prescription recorded pre-deload
 * numbers for (BF-64).
 *
 * **Why the override is a revert and not a regeneration.** Before this, choosing `Full` changed
 * nothing: `session-data.ts` applies the deload override inside an `else if` that runs only when the
 * prescription's exercise is not already deloaded, so the pipeline could ADD a deload and never
 * remove one — the toggle offered an `Override` that overrode nothing. The numbers to go back to are
 * already on the device in each exercise's `preDeload` block, so this reuses `applyDeloadReverts`:
 * no LLM call, no 429 budget, works offline. A `/prescribe` round-trip would cost a rebuild to reach
 * numbers we hold, and the route takes no intensity input at all (`PrescribeBodySchema` is
 * `excludeSessionId` + `durationPreset`), so there is no server path even in principle.
 *
 * **1RM/PR accounting follows without a separate change, and that is by design.** The revert clears
 * `deloaded`, `handleLogSet` reads the reverted array, and its gate is
 * `ex.deloaded === true || (isAnyDeload && !isBaseline)` with `deload` false under an override — so
 * a reverted exercise runs full weights and counts, and one that could not revert does not.
 *
 * An exercise with no `preDeloadStyle` is **absent by construction**, which decides the optional-
 * `preDeload` case: it stays deloaded, the conservative answer, and the prescription card names it.
 * `applyDeloadReverts` would skip it anyway; excluding it here is what lets the caller ask which
 * ones were skipped.
 */
export function deloadRevertNames(
  exercises: readonly Pick<WorkoutExercise, 'name' | 'deloaded' | 'preDeloadStyle'>[],
  perExerciseReverts: readonly string[],
  overrideFull: boolean,
): string[] {
  if (!overrideFull) return [...perExerciseReverts]
  const all = exercises.filter(ex => ex.deloaded && ex.preDeloadStyle).map(ex => ex.name)
  return [...new Set([...perExerciseReverts, ...all])]
}

/** Deloaded exercises a session-level override could NOT revert, because the prescription carried
 *  no `preDeload` block for them. Named on the card: silently reverting some and not others, with
 *  nothing on screen saying which, is the failure the fix would otherwise introduce. */
export function deloadOverrideBlocked(
  exercises: readonly Pick<WorkoutExercise, 'name' | 'deloaded' | 'preDeloadStyle'>[],
  overrideFull: boolean,
): string[] {
  return overrideFull ? exercises.filter(ex => ex.deloaded && !ex.preDeloadStyle).map(ex => ex.name) : []
}

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

/**
 * The context line in the active workout's header — phase, position, and whether today is a deload.
 *
 * **`isDeloadActive` answers the wrong question** (BF-8). It means "is the current PHASE a deload
 * week", so a deload the prescription applied for its own reasons — a readiness-driven, auto-applied
 * one — printed as an ordinary session all the way to the last set. The owner trained one believing
 * it was a full session and said so: *"I was under the assumption I was doing my full session but it
 * looks like it has been deload... its too hidden."*
 *
 * So a session deload is called out too, and it keeps the phase context rather than replacing it: a
 * phase deload has no cycle position worth printing, but a readiness deload inside Accumulation
 * still happens somewhere, and dropping "Accumulation · S1" to say "Deload" alone trades one missing
 * fact for another.
 *
 * Extracted here rather than written inline because the identical predicate governs the pre-workout
 * intensity toggle, and a fix to one surface alone leaves the other lying — which is the
 * sibling-surface sweep `CLAUDE.md` requires. Also because both vitest projects run in `node`, where
 * a `.tsx` cannot be imported: a string helper is the part that can actually be pinned.
 */
export function sessionContextLabel(
  phaseStatus: PhaseStatus | null | undefined,
  sessionIsDeload: boolean,
): string {
  if (phaseStatus?.isDeloadActive) return "Deload · ";
  const deload = sessionIsDeload ? "Deload · " : "";
  if (!phaseStatus) return deload;
  const position = phaseStatus.openEnded
    ? `S${phaseStatus.phaseSessionNumber}`
    : `C${phaseStatus.cycleInPhase}/${phaseStatus.totalPhaseCycles}`;
  return `${phaseStatus.phase.name} · ${position} · ${deload}`;
}
