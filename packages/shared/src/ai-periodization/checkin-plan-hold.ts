// #3890 (decision 8, "Heavy holds the lift by itself"): the weekly check-in's hold on a plan.
//
// A lift the saved check-in for a week answered "Heavy" for is held for that week (its local Monday to
// Sunday): no prescribed bar of it is heavier than the bar the person last used for it. A ceiling,
// never a floor, and only on the load: sets and reps are not changed by it, and every other lift is
// left exactly as it was. Enforced in code after the model, as the preference clamp is.
//
// The hold arrives through the one per-lift reader (`loadLiftPreferences`, `checkinHold` on the lift's
// preference). It is applied:
//   - at generation, after the model and every load rule (`generate-prescription.ts`), and in the rules
//     fallback, through `holdPlanRows`;
//   - on a session reader's style (`liftPreferenceOnStyle` in `workout/session-data.ts`: the static path
//     through `applyLiftPreferenceToStyle`, and an AI-driven row), the one step the session screen and the
//     Next workout card both run;
//   - where a STORED plan is served (`holdStoredPlanUnderCheckin`, run by `fitStoredPlanToCheckinBudget`
//     in the four read paths). A save or an undo of the check-in touches no stored plan, so a plan stored
//     before the save is held here when it is served inside the week, and given its own load back when
//     it is served after an undo or in a later week (`AiPrescription.checkinHold` keeps that load);
//   - after the consumption-day re-evaluation (`rehold`), whose deload revert puts an unheld load back.
// The "last bar" is the heaviest working weight logged in the lift's most recent session
// (`lastSessionBarKg`). A lift lowered by the check-in gets the lower of: one step under the plan, and
// its last bar.
// Not in a deload or a baseline, not on a row a deload cut, not on a bodyweight lift.
import { formatInTimeZone } from 'date-fns-tz'
import { weekStartForDay } from '@trainingai/shared/date-utils'
import { checkinHoldBar, pctUnderBar, type LiftPreference } from '@trainingai/shared/ai-periodization/lift-preference'
import { liftPreferenceBases, loadLiftPreferences } from '@trainingai/shared/ai-periodization/lift-preference-read'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'

/** What the hold needs to know about one row's lift. Absent: the row is not held. */
export interface HoldRowCtx {
  preference: LiftPreference
  basisKg: number | null
  equipment: string[] | null | undefined
  bodyweight: boolean
}

export type CheckinHoldRecord = NonNullable<AiPrescription['checkinHold']>

/**
 * Pure: the held pct of each row the hold lowers, and the record a stored plan keeps of it. Rows the
 * hold does not lower are not in `pct`. `record` is absent when no row was lowered.
 */
export function holdPlanRows(
  rows: readonly { id: string; pct: number }[],
  ctxFor: (id: string) => HoldRowCtx | undefined,
): { pct: Map<string, number>; record?: CheckinHoldRecord } {
  const pct = new Map<string, number>()
  const recorded: CheckinHoldRecord['rows'] = {}
  let weekStart: string | null = null
  for (const row of rows) {
    const ctx = ctxFor(row.id)
    const bar = ctx ? checkinHoldBar(ctx.preference, ctx) : null
    if (bar == null) continue
    const held = pctUnderBar(row.pct, ctx!.basisKg, ctx!.equipment, bar)
    if (held >= row.pct) continue
    pct.set(row.id, held)
    recorded[row.id] = { pct: row.pct, heldPct: held }
    weekStart = ctx!.preference.checkinHold!.weekStart
  }
  return weekStart ? { pct, record: { weekStart, rows: recorded } } : { pct }
}

/** Two hold records alike, whatever their key order (a stored plan comes back from `jsonb` reordered). */
export function sameHoldRecord(a: CheckinHoldRecord | undefined, b: CheckinHoldRecord | undefined): boolean {
  if (!a || !b) return !a && !b
  const ids = Object.keys(a.rows)
  return a.weekStart === b.weekStart && ids.length === Object.keys(b.rows).length
    && ids.every(id => b.rows[id] != null && b.rows[id].pct === a.rows[id].pct && b.rows[id].heldPct === a.rows[id].heldPct)
}

/**
 * Pure: a stored plan as served in the week starting `weekStart`, with `ctxFor` giving each row's hold
 * for that week (absent: not held). A row the hold lowered before starts again from the pct it had (a
 * row whose pct has been rewritten since is taken as it now is); a held row is lowered from there, any
 * other row gets that pct back. Returns the same object when nothing changes.
 */
export function holdStoredPrescription(
  stored: AiPrescription,
  weekStart: string,
  ctxFor: (row: AiPrescription['exercises'][number]) => HoldRowCtx | undefined,
): AiPrescription {
  const marker = stored.checkinHold
  const recorded: CheckinHoldRecord['rows'] = {}
  let changed = false
  let lowered = false
  const exercises = stored.exercises.map(ex => {
    const m = marker?.rows[ex.sessionExerciseId]
    // A row a deload cut since it was held is not held, but keeps its record: its pre-deload load is the
    // held one, so a revert, and the week's end, still know the load it had of its own.
    if (ex.deloaded) {
      if (m) recorded[ex.sessionExerciseId] = m
      return ex
    }
    const base = m && ex.pct === m.heldPct ? m.pct : ex.pct
    const ctx = stored.deload ? undefined : ctxFor(ex)
    const bar = ctx ? checkinHoldBar(ctx.preference, ctx) : null
    const next = bar != null ? pctUnderBar(base, ctx!.basisKg, ctx!.equipment, bar) : base
    if (next < base) { recorded[ex.sessionExerciseId] = { pct: base, heldPct: next }; lowered = true }
    if (next === ex.pct) return ex
    changed = true
    return { ...ex, pct: next }
  })
  // Only carried records (deloaded rows) left: they keep the week they were made in.
  const record = Object.keys(recorded).length > 0 ? { weekStart: lowered ? weekStart : marker!.weekStart, rows: recorded } : undefined
  if (!changed && sameHoldRecord(record, marker)) return stored
  const { checkinHold: _previous, ...rest } = stored
  return { ...rest, exercises, ...(record && { checkinHold: record }) }
}

/**
 * Pure: a held row rewritten by another no-model rule (the Coach's restate of a preference), so the hold's
 * record stays true. The rule is run on the row's own load (`pct` in the record), and the hold's ceiling
 * (`heldPct`, which depends only on the bar it holds to) is put back over the result: a result at or
 * under it needs no hold and drops its record. A row the hold did not lower is rewritten as it is.
 * Returns the new row and the new record for it (absent: none).
 */
export function rewriteHeldRow<R extends { sessionExerciseId: string; pct: number }>(
  row: R,
  record: CheckinHoldRecord | undefined,
  rewrite: (row: R) => R,
): { row: R; held?: { pct: number; heldPct: number } } {
  const m = record?.rows[row.sessionExerciseId]
  if (!m || row.pct !== m.heldPct) return { row: rewrite(row) }
  const own = rewrite({ ...row, pct: m.pct })
  if (own.pct <= m.heldPct) return { row: own }
  return { row: { ...own, pct: m.heldPct }, held: { pct: own.pct, heldPct: m.heldPct } }
}

/**
 * #3890: a plan another serve-time rule has just rewritten (the consumption-day re-evaluation, whose
 * revert puts a deloaded row's pre-deload load back), held again by the same pure rule
 * (`holdStoredPrescription`), from the preferences the caller already read for `weekStart` through the
 * one per-lift reader. No query: `lift` gives a row's basis, equipment and type from what the caller
 * has. Returns the same object when the week holds no lift and the plan carries no hold.
 */
export function rehold(
  prescription: AiPrescription,
  phase: string,
  weekStart: string,
  prefs: ReadonlyMap<string, LiftPreference>,
  lift: (name: string) => Omit<HoldRowCtx, 'preference'>,
): AiPrescription {
  const anyHeld = [...prefs.values()].some(p => p.checkinHold?.weekStart === weekStart)
  if (!anyHeld && !prescription.checkinHold) return prescription
  const inPhase = phase !== 'deload' && phase !== 'baseline' && !prescription.deload
  return holdStoredPrescription(prescription, weekStart, ex => {
    const preference = prefs.get(ex.name)
    if (!inPhase || preference?.checkinHold?.weekStart !== weekStart || preference.checkinHold.barKg == null) return undefined
    return { preference, ...lift(ex.name) }
  })
}

/** The statuses whose plan is still the one the lifter is about to train (the re-fit's set). */
const SERVABLE = new Set(['pending', 'accepted', 'auto_applied'])

/**
 * The hold of each of `names` for the week starting `weekStart`, read through the one per-lift reader,
 * keyed by name. A lift with no hold, or whose hold has no last bar, is absent (it caps nothing).
 */
async function loadHoldCtx(
  repo: WorkoutRepository, userId: string, names: readonly string[], weekStart: string,
): Promise<Map<string, HoldRowCtx>> {
  const out = new Map<string, HoldRowCtx>()
  if (names.length === 0) return out
  const prefs = await loadLiftPreferences(repo, userId, names, { checkinWeekStart: weekStart })
  const held = new Map([...prefs].filter(([, p]) => p.checkinHold?.barKg != null))
  if (held.size === 0) return out
  const heldNames = [...held.keys()]
  const [prMap, equipment, types] = await Promise.all([
    repo.listPersonalRecords(userId),
    repo.getExerciseEquipment(heldNames),
    repo.getExerciseTypes(heldNames),
  ])
  const bases = await liftPreferenceBases(repo, userId, held, prMap)
  for (const [name, preference] of held) {
    out.set(name, {
      preference, basisKg: bases.get(name) ?? null, equipment: equipment[name] ?? [], bodyweight: types[name] === 'bodyweight',
    })
  }
  return out
}

/** Whether the hold may lower this state's plan at all: not in a deload or a baseline. */
const holdApplies = (state: SessionPeriodization, stored: AiPrescription) =>
  state.phase !== 'deload' && state.phase !== 'baseline' && !stored.deload

/**
 * #3890: a stored plan as it is served on `now`'s local date, under that week's check-in hold. With no
 * hold for that week and no hold on the plan it returns `state` as it came, with no query: the held
 * weeks ride on the stored-plan read itself (`checkinHeldWeeks`). Otherwise the lifts are read through
 * the one per-lift reader for that week, the plan is held (or given its own load back) and served.
 *
 * The plan served is always the one computed here; storing it is only a cache, so it never decides what
 * is served. The store is guarded on the plan being the one read, so a plan remade meanwhile is never
 * overwritten:
 *  - the store throws: the held plan is served all the same;
 *  - the store loses (another read held it first, or the plan was remade): the stored plan is read once
 *    more, held in memory by the same pure rule (`holdStoredPrescription`) and served, with no second
 *    write. Several reads at once therefore all serve the held bar, and exactly one of them writes.
 * A failed read of the lifts (their holds, bars or bases) serves the plan as stored: with no bar there
 * is nothing to hold it to.
 */
export async function holdStoredPlanUnderCheckin<T extends SessionPeriodization>(
  userId: string,
  programSessionId: string,
  repo: WorkoutRepository,
  tz: string,
  state: T,
  now = new Date(),
): Promise<T> {
  const stored = state.prescription
  if (!stored) return state
  const weekStart = weekStartForDay(formatInTimeZone(now, tz, 'yyyy-MM-dd'))
  const heldWeek = state.checkinHeldWeeks?.includes(weekStart) === true
  if (!heldWeek && !stored.checkinHold) return state
  if (!SERVABLE.has(state.prescriptionStatus)) return state
  if (state.prescriptionExpiresAt != null && state.prescriptionExpiresAt <= now) return state
  let ctxByName: Map<string, HoldRowCtx>
  const asked = new Set<string>()
  try {
    const names = heldWeek && holdApplies(state, stored) ? stored.exercises.map(e => e.name) : []
    names.forEach(nm => asked.add(nm))
    ctxByName = await loadHoldCtx(repo, userId, names, weekStart)
  } catch (err) {
    console.error('[weekly-checkin] reading the hold for the stored plan failed; serving it as stored:', err)
    return state
  }
  const next = holdStoredPrescription(stored, weekStart, ex => ctxByName.get(ex.name))
  if (next === stored) return state
  const held = { ...state, prescription: next }
  if (typeof repo.replacePrescriptionIfUnchanged !== 'function') return held
  let won: boolean
  try {
    won = await repo.replacePrescriptionIfUnchanged(userId, programSessionId, stored, next)
  } catch (err) {
    console.error('[weekly-checkin] storing the held plan failed; serving it held, unstored:', err)
    return held
  }
  if (won) return held
  // Lost the swap: serve what is stored now, held by the same rule, and write nothing.
  try {
    const current = await repo.getSessionPeriodization(userId, programSessionId)
    const now2 = current?.prescription
    if (!current || !now2) return held
    const merged = { ...state, ...current, prescription: now2 } as T
    if (!heldWeek && !now2.checkinHold) return merged
    if (heldWeek && holdApplies(current, now2)) {
      const missing = [...new Set(now2.exercises.map(e => e.name))].filter(nm => !asked.has(nm))
      if (missing.length > 0) {
        for (const [nm, ctx] of await loadHoldCtx(repo, userId, missing, weekStart)) ctxByName.set(nm, ctx)
      }
    }
    const ctxNow = heldWeek && holdApplies(current, now2) ? ctxByName : new Map<string, HoldRowCtx>()
    return { ...merged, prescription: holdStoredPrescription(now2, weekStart, ex => ctxNow.get(ex.name)) }
  } catch (err) {
    console.error('[weekly-checkin] re-reading the stored plan after a lost store failed; serving the held plan read first:', err)
    return held
  }
}
