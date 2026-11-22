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
//   - on the static-style path (`applyLiftPreferenceToStyle`);
//   - where a STORED plan is served (`holdStoredPlanUnderCheckin`, run by `fitStoredPlanToCheckinBudget`
//     in the four read paths). A save or an undo of the check-in touches no stored plan, so a plan stored
//     before the save is held here when it is served inside the week, and given its own load back when
//     it is served after an undo or in a later week (`AiPrescription.checkinHold` keeps that load).
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
  const exercises = stored.exercises.map(ex => {
    if (ex.deloaded) return ex
    const m = marker?.rows[ex.sessionExerciseId]
    const base = m && ex.pct === m.heldPct ? m.pct : ex.pct
    const ctx = stored.deload ? undefined : ctxFor(ex)
    const bar = ctx ? checkinHoldBar(ctx.preference, ctx) : null
    const next = bar != null ? pctUnderBar(base, ctx!.basisKg, ctx!.equipment, bar) : base
    if (next < base) recorded[ex.sessionExerciseId] = { pct: base, heldPct: next }
    if (next === ex.pct) return ex
    changed = true
    return { ...ex, pct: next }
  })
  const record = Object.keys(recorded).length > 0 ? { weekStart, rows: recorded } : undefined
  if (!changed && JSON.stringify(record ?? null) === JSON.stringify(marker ?? null)) return stored
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

/** The statuses whose plan is still the one the lifter is about to train (the re-fit's set). */
const SERVABLE = new Set(['pending', 'accepted', 'auto_applied'])

/**
 * #3890: a stored plan as it is served on `now`'s local date, under that week's check-in hold. With no
 * hold for that week and no hold on the plan it returns `state` as it came, with no query: the held
 * weeks ride on the stored-plan read itself (`checkinHeldWeeks`). Otherwise the lifts are read through
 * the one per-lift reader for that week, the plan is held (or given its own load back), stored with no
 * model call, and served. The store is guarded on the plan being the one read, so a plan remade
 * meanwhile is never overwritten; the next read holds the new one.
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
  if (typeof repo.replacePrescriptionIfUnchanged !== 'function') return state
  try {
    const ctxByName = new Map<string, HoldRowCtx>()
    const inPhase = state.phase !== 'deload' && state.phase !== 'baseline' && !stored.deload
    if (heldWeek && inPhase) {
      const prefs = await loadLiftPreferences(repo, userId, stored.exercises.map(e => e.name), { checkinWeekStart: weekStart })
      const held = new Map([...prefs].filter(([, p]) => p.checkinHold?.barKg != null))
      if (held.size > 0) {
        const names = [...held.keys()]
        const [prMap, equipment, types] = await Promise.all([
          repo.listPersonalRecords(userId),
          repo.getExerciseEquipment(names),
          repo.getExerciseTypes(names),
        ])
        const bases = await liftPreferenceBases(repo, userId, held, prMap)
        for (const [name, preference] of held) {
          ctxByName.set(name, {
            preference, basisKg: bases.get(name) ?? null, equipment: equipment[name] ?? [], bodyweight: types[name] === 'bodyweight',
          })
        }
      }
    }
    const next = holdStoredPrescription(stored, weekStart, ex => ctxByName.get(ex.name))
    if (next === stored) return state
    const ok = await repo.replacePrescriptionIfUnchanged(userId, programSessionId, stored, next)
    return ok ? { ...state, prescription: next } : state
  } catch (err) {
    console.error('[weekly-checkin] applying the hold to the stored plan failed; serving it as stored:', err)
    return state
  }
}
