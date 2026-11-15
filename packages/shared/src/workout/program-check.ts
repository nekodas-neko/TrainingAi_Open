/**
 * Check a generated program in code, and repair what code can repair (#3751).
 *
 * The `/api/generate-program` prompt ends by asking the model to tally its own sets, confirm its
 * own time budget and confirm its own back-to-back sessions. Nothing checked whether it had. These
 * are the three checks, done here on the program after names are resolved:
 *
 *  - **time**: each session's minutes from its styles and equipment, through
 *    `estimateProgramSessionSec` (the same `styleWorkSec` + setup-overhead model the prompt quotes
 *    and the session cards show), against `workingBudgetMin` of the time budget. Over budget,
 *    accessories are trimmed in the order the prompt already states: small-muscle isolation first,
 *    then large-muscle isolation, never a compound. Still over after that is said, not fixed.
 *  - **weekly sets** per large muscle, from each exercise's style (main 1, secondary 0.5, the
 *    `roleWeight` the volume tallies use), against the goal's MEV from `volumeLandmarks`.
 *  - **neighbours**: sessions that run on consecutive days, from the schedule, sharing a muscle
 *    their compounds lead with.
 *
 * A miss comes back as a plain sentence for the builder screen. The model is never asked again.
 */
import { normalizeMuscle, roleWeight } from '../muscles'
import { volumeLandmarks } from '../ai-periodization/volume-targets'
import { workingBudgetMin } from './duration-model'
import { estimateProgramSessionSec, type StyleSetForDuration } from './program-session-duration'
import type { GeneratedExercise, GeneratedSession } from '../types/builder'

/**
 * The large muscles the prompt prioritises, each with the library muscle names that count toward
 * it. "Back" has no single library muscle: the catalogue and the builder's focus picker say "Lats"
 * and "Upper Back", and both are back volume.
 */
export const LARGE_MUSCLE_GROUPS: ReadonlyArray<{ key: string; label: string; muscles: readonly string[] }> = [
  { key: 'chest', label: 'Chest', muscles: ['chest'] },
  { key: 'back', label: 'Back', muscles: ['back', 'lats', 'upper back'] },
  { key: 'quads', label: 'Quads', muscles: ['quads'] },
  { key: 'hamstrings', label: 'Hamstrings', muscles: ['hamstrings'] },
  { key: 'glutes', label: 'Glutes', muscles: ['glutes'] },
]

const LARGE_MUSCLES = new Set(LARGE_MUSCLE_GROUPS.flatMap(g => g.muscles))

const isLarge = (muscle: string) => LARGE_MUSCLES.has(normalizeMuscle(muscle))

export type ProgramSchedule =
  | { type: 'rotation'; restAfterN: number }
  | { type: 'weekly'; days: readonly number[] }

/**
 * Which pairs of sessions (by index) ever run on consecutive days under this schedule, in the order
 * first met. A rotation is simulated over one full repeat of its pattern rather than reasoned about, because the
 * answer depends on how the cycle length and the rest pattern line up: 3 sessions with a rest after
 * every 3 never put session 3 before session 1 on consecutive days, while 4 sessions with a rest
 * after every 3 eventually put every neighbour pair back to back.
 *
 * Weekly days map to sessions the same way every week (`builder-review.tsx` saves the k-th day with
 * session k mod n), and Sunday runs into Monday. A pair of a session with itself is not reported.
 */
export function backToBackPairs(sessionCount: number, schedule: ProgramSchedule): Array<[number, number]> {
  if (sessionCount < 2) return []
  const seen = new Set<string>()
  const pairs: Array<[number, number]> = []
  const add = (a: number, b: number) => {
    if (a === b) return
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push([a, b])
  }

  if (schedule.type === 'rotation') {
    const n = Math.max(1, schedule.restAfterN)
    const span = lcm(sessionCount, n)
    for (let j = 0; j < span; j++) {
      if ((j + 1) % n === 0) continue // a rest day follows this session
      add(j % sessionCount, (j + 1) % sessionCount)
    }
    return pairs
  }

  // The same fixed mapping every week: the k-th training day always runs session k mod n.
  const days = [...new Set(schedule.days)].sort((a, b) => a - b)
  for (let k = 0; k < days.length; k++) {
    const nextK = (k + 1) % days.length
    if ((days[nextK] - days[k] + 7) % 7 === 1) add(k % sessionCount, nextK % sessionCount)
  }
  return pairs
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b) }
function lcm(a: number, b: number): number { return (a / gcd(a, b)) * b }

export interface ProgramCheckInput {
  sessions: readonly GeneratedSession[]
  goal: string
  /** Minutes per session the user asked for, or null for no limit. */
  timePerSessionMinutes: number | null
  schedule: ProgramSchedule
  /** The user's styles' sets, by style id — the shape the program's exercises point at. */
  styleSetsById: ReadonlyMap<string, ReadonlyArray<StyleSetForDuration>>
  /** An exercise's equipment from the library, for its setup overhead. */
  equipmentOf: (exerciseName: string) => string[] | undefined
  /** Lowercased focus muscles. A large muscle is only held to its range when the user asked for it. */
  focusMuscles: ReadonlySet<string>
}

export interface TrimmedExercise { session: string; exercise: string }
export interface OverBudgetSession { session: string; minutes: number }
export interface MuscleUnderRange { label: string; sets: number; minimum: number }
export interface SharedNeighbours { first: string; second: string; muscles: string[] }

export interface ProgramCheckResult {
  /** The program after trimming. The input is not mutated. */
  sessions: GeneratedSession[]
  /** The working minutes a session may take, or null with no time limit. */
  budgetMin: number | null
  trimmed: TrimmedExercise[]
  overBudget: OverBudgetSession[]
  underRange: MuscleUnderRange[]
  sharedNeighbours: SharedNeighbours[]
  /** One plain sentence per finding, for the builder screen. */
  notes: string[]
}

function sessionSec(session: GeneratedSession, input: ProgramCheckInput): number {
  return estimateProgramSessionSec(
    session.exercises.map(ex => ({ exerciseName: ex.name, styleId: ex.progressionStyleId })),
    input.styleSetsById,
    input.equipmentOf,
  ) ?? 0
}

/**
 * Trim order, lowest first: an accessory whose main muscles are all small, then any other
 * accessory. Compounds are never candidates. Within a tier the last exercise goes first, because
 * the model lists a session's work in the order it should be done and the tail is the least
 * important.
 */
function trimCandidates(exercises: readonly GeneratedExercise[]): number[] {
  const accessories = exercises
    .map((ex, i) => ({ ex, i }))
    .filter(({ ex }) => ex.exerciseRole === 'accessory')
  const smallOnly = ({ ex }: { ex: GeneratedExercise }) => !ex.mainMuscles.some(isLarge)
  return [
    ...accessories.filter(smallOnly).reverse(),
    ...accessories.filter(a => !smallOnly(a)).reverse(),
  ].map(({ i }) => i)
}

function trimToBudget(
  session: GeneratedSession,
  budgetSec: number,
  input: ProgramCheckInput,
): { session: GeneratedSession; removed: string[]; sec: number } {
  let current = session
  let sec = sessionSec(current, input)
  const removed: string[] = []
  // Never trim a session to nothing: an all-accessory session (an Arms day) keeps its last
  // exercise, and the over-budget note says it is still over.
  while (sec > budgetSec && current.exercises.length > 1) {
    const [next] = trimCandidates(current.exercises)
    if (next === undefined) break
    removed.push(current.exercises[next].name)
    current = { ...current, exercises: current.exercises.filter((_, i) => i !== next) }
    sec = sessionSec(current, input)
  }
  return { session: current, removed, sec }
}

function weeklySets(sessions: readonly GeneratedSession[], input: ProgramCheckInput, muscles: readonly string[]): number {
  const group = new Set(muscles)
  let total = 0
  for (const session of sessions) {
    for (const ex of session.exercises) {
      const sets = ex.progressionStyleId ? input.styleSetsById.get(ex.progressionStyleId)?.length ?? 0 : 0
      if (sets === 0) continue
      // One exercise counts once toward a group, at its strongest role in it: a row tagged both
      // Lats (main) and Upper Back (secondary) is one back exercise, not one and a half.
      const weight = ex.mainMuscles.some(m => group.has(normalizeMuscle(m)))
        ? roleWeight('main')
        : ex.secondaryMuscles.some(m => group.has(normalizeMuscle(m)))
          ? roleWeight('secondary')
          : 0
      total += sets * weight
    }
  }
  return total
}

/** The muscles a session's compounds lead with: main muscles of its primary and secondary lifts. */
function leadMuscles(session: GeneratedSession): string[] {
  const out = new Set<string>()
  for (const ex of session.exercises) {
    if (ex.exerciseRole === 'accessory') continue
    for (const m of ex.mainMuscles) out.add(normalizeMuscle(m))
  }
  return [...out]
}

const fmtSets = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1))
const muscleLabel = (m: string) => m.replace(/\b\w/g, c => c.toUpperCase())

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function checkGeneratedProgram(input: ProgramCheckInput): ProgramCheckResult {
  const budgetMin = input.timePerSessionMinutes ? workingBudgetMin(input.timePerSessionMinutes) : null
  const trimmed: TrimmedExercise[] = []
  const overBudget: OverBudgetSession[] = []

  const sessions = input.sessions.map(session => {
    if (budgetMin === null) return session
    const result = trimToBudget(session, budgetMin * 60, input)
    for (const exercise of result.removed) trimmed.push({ session: session.name, exercise })
    if (result.sec > budgetMin * 60) overBudget.push({ session: session.name, minutes: Math.ceil(result.sec / 60) })
    return result.session
  })

  const askedForAll = input.focusMuscles.has('full body')
  const underRange: MuscleUnderRange[] = []
  for (const group of LARGE_MUSCLE_GROUPS) {
    if (!askedForAll && !group.muscles.some(m => input.focusMuscles.has(m))) continue
    const sets = weeklySets(sessions, input, group.muscles)
    const minimum = volumeLandmarks(input.goal, group.key).mev
    if (sets < minimum) underRange.push({ label: group.label, sets, minimum })
  }

  const sharedNeighbours: SharedNeighbours[] = []
  for (const [a, b] of backToBackPairs(sessions.length, input.schedule)) {
    const second = new Set(leadMuscles(sessions[b]))
    const muscles = leadMuscles(sessions[a]).filter(m => second.has(m))
    if (muscles.length > 0) sharedNeighbours.push({ first: sessions[a].name, second: sessions[b].name, muscles })
  }

  const notes: string[] = []
  const minutesWord = input.timePerSessionMinutes
  for (const t of trimmed) {
    notes.push(`Removed ${t.exercise} from ${t.session} to fit the ${minutesWord}-minute session.`)
  }
  for (const o of overBudget) {
    notes.push(`${o.session} is estimated at ${o.minutes} working minutes, over the ${budgetMin} a ${minutesWord}-minute session leaves after warm-up.`)
  }
  for (const u of underRange) {
    notes.push(`${u.label} gets ${fmtSets(u.sets)} sets a week, under the ${u.minimum} this goal starts at.`)
  }
  for (const s of sharedNeighbours) {
    notes.push(`${s.first} and ${s.second} can fall on consecutive days and both lead with ${listWords(s.muscles.map(muscleLabel))}.`)
  }

  return { sessions, budgetMin, trimmed, overBudget, underRange, sharedNeighbours, notes }
}
