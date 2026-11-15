import { isCalendarDate, shiftDateStr, weekStartForDay } from '../date-utils'

/**
 * Issue 3779. The walking and heart-health plan's two targets — steps per day and active minutes
 * per week — with how they start, how and when they grow, their ceilings, the offered step back,
 * and what marks a day done. Signed by the owner on 15 Nov 2026 as written in the proposal of
 * 14 Nov 22:20Z; every number below is from its two tables.
 *
 * | | Starts at | Grows by | When | Ceiling |
 * |---|---|---|---|---|
 * | Steps, per day | own steps goal if set; else the median of the last 28 days, rounded up to the next 500 | 500 | after two weeks in which 5 or more days met it | 12,000, or the own goal if higher |
 * | Active minutes, per week | median weekly active minutes over the last 4 weeks, rounded up to the next 10, at least 60 | 15 | after any week that met it | 150; 300 for "heart health plus" |
 *
 * - A target never drops on its own. After two weeks in a row that missed it by more than 25%, the
 *   plan OFFERS a step back to the last level that was met (`stepBackOffers`); only the person's
 *   yes applies it (`applyStepBack`).
 * - A day with a rest day logged, or a sick check-in, is left out of every count.
 * - A day is done when either target's daily share is met: the day's steps, or one-seventh of the
 *   weekly minutes (`walkingDayVerdict`).
 *
 * Pure: every date in is a user-local `YYYY-MM-DD` the caller derived with `todayInTz`, and weeks
 * are the app's Monday-to-Sunday weeks (`weekStartForDay`). It decides what the plan asks for and
 * whether a day or week counts; no stored score reads it.
 *
 * Choices the tables leave open, made here and stated in the PR:
 * - "Rounded up to the next 500/10" is a ceiling to that multiple; an exact multiple stays.
 * - "Two weeks in which 5 or more days met it" means two judged weeks in a row at the current level.
 * - A week is judged once it has ended, but the verdict stays provisional for `JUDGE_GRACE_DAYS`
 *   (two) after its Sunday and is re-judged on every settle until then; only then is it frozen
 *   into the stored state (`settleWeeks`). Sunday's steps or a walk often sync on Monday or later.
 *   The plan's first week is judged only when the plan started on its Monday; a part week is shown
 *   and its days complete, but it moves no target.
 * - A left-out day is out of every count, the steps rule's included: a week meets it when at least
 *   `min(5, countedDays)` counted days met the day's target. A week with every day left out (a
 *   whole week sick) moves nothing and breaks no streak.
 * - "Missed by more than 25%": minutes under 75% of the week's target; steps, a mean over the
 *   week's counted days with a reading under 75% of the day's target. A week with no step reading
 *   at all is not evidence of a miss.
 */

export const STEPS_ROUND_TO = 500
export const STEPS_GROWTH = 500
export const STEPS_CEILING = 12_000
export const STEPS_DAYS_TO_MEET_WEEK = 5
export const STEPS_WEEKS_TO_GROW = 2
export const STEPS_BASELINE_DAYS = 28

export const MINUTES_ROUND_TO = 10
export const MINUTES_GROWTH = 15
export const MINUTES_START_FLOOR = 60
export const MINUTES_CEILING = 150
export const MINUTES_CEILING_PLUS = 300
export const MINUTES_BASELINE_WEEKS = 4

export const STEP_BACK_MISS_SHARE = 0.25
export const STEP_BACK_WEEKS = 2

/**
 * Days after a week's Sunday during which its verdict is provisional and re-judged on each settle.
 * Two: Health Connect and the Oura Cloud catch up when the phone or the ring next syncs, which can
 * be a day late after a weekend away from either; past two days a late reading is rare, and
 * waiting longer would hold the week's growth back for no gain. Frozen from the Wednesday.
 */
export const JUDGE_GRACE_DAYS = 2

/** Week records kept on the plan — enough for the screens' history and the step-back rule. */
export const WEEK_HISTORY_KEPT = 12

export type MinutesCeiling = typeof MINUTES_CEILING | typeof MINUTES_CEILING_PLUS
export type StepsStartBasis = 'own_goal' | 'median' | 'default'
export type MinutesStartBasis = 'median' | 'floor'
export type WalkingTarget = 'steps' | 'minutes'
export type DayExclusion = 'rest' | 'sick'

export interface WalkingWeekRecord {
  weekStart: string
  /** The levels in force during the week. */
  stepsTarget: number
  minutesTarget: number
  countedDays: number
  stepDaysMet: number
  /** Mean steps over the counted days with a reading; null when none had one. */
  meanSteps: number | null
  activeMinutes: number
  stepsMet: boolean
  minutesMet: boolean
  /** Every day was left out (rest or sick), so the week moved nothing. */
  excluded: boolean
  /** Judged inside the grace period: shown, but not yet frozen (never stored). */
  provisional?: boolean
}

/** What the plan stores (on `running_plans.fitness_snapshot.walkingPlan`, no migration). */
export interface WalkingPlanState {
  version: 1
  /** The plan's first local day. */
  startDate: string
  stepsTarget: number
  minutesTarget: number
  minutesCeiling: MinutesCeiling
  startLevels: { steps: number; minutes: number; stepsBasis: StepsStartBasis; minutesBasis: MinutesStartBasis }
  /** Judged weeks in a row at the current steps level with 5+ days met. */
  stepsStreak: number
  /** Judged weeks in a row that missed each target by more than 25%. */
  stepsMissStreak: number
  minutesMissStreak: number
  /** The last level at which a week met each target; null until one has. */
  stepsLastMet: number | null
  minutesLastMet: number | null
  /** The Monday of the next week to judge. */
  nextWeekToJudge: string
  weeks: WalkingWeekRecord[]
}

export function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** 12,000, or the person's own goal when it is higher. */
export function stepsCeiling(ownStepsGoal: number | null | undefined): number {
  return ownStepsGoal != null && ownStepsGoal > STEPS_CEILING ? Math.round(ownStepsGoal) : STEPS_CEILING
}

/**
 * The starting steps target. `recentDailySteps` is each of the 28 local days before the plan
 * started that has a step count and was not left out; `fallbackGoal` is the app's step goal
 * (`getDailyGoals`), used only when there is neither an own goal nor any history.
 */
export function startingStepsTarget(input: {
  ownStepsGoal: number | null | undefined
  recentDailySteps: readonly number[]
  fallbackGoal: number
}): { target: number; basis: StepsStartBasis } {
  const ceiling = stepsCeiling(input.ownStepsGoal)
  if (input.ownStepsGoal != null && input.ownStepsGoal > 0) {
    return { target: Math.min(Math.round(input.ownStepsGoal), ceiling), basis: 'own_goal' }
  }
  const m = median(input.recentDailySteps)
  if (m != null && m > 0) return { target: Math.min(roundUpTo(m, STEPS_ROUND_TO), ceiling), basis: 'median' }
  return { target: Math.min(roundUpTo(Math.max(STEPS_ROUND_TO, input.fallbackGoal), STEPS_ROUND_TO), ceiling), basis: 'default' }
}

/**
 * The starting weekly minutes target. `recentWeeklyMinutes` is the active minutes (as
 * `walking-minutes.ts` counts them) of each of the 4 full weeks before the plan's first week, a
 * week with nothing in it as 0.
 */
export function startingMinutesTarget(
  recentWeeklyMinutes: readonly number[],
  ceiling: MinutesCeiling = MINUTES_CEILING,
): { target: number; basis: MinutesStartBasis } {
  const m = median(recentWeeklyMinutes)
  const fromMedian = m != null ? roundUpTo(m, MINUTES_ROUND_TO) : 0
  if (fromMedian >= MINUTES_START_FLOOR) return { target: Math.min(fromMedian, ceiling), basis: 'median' }
  return { target: MINUTES_START_FLOOR, basis: 'floor' }
}

/** The first Monday the plan judges: its start day when that is a Monday, else the next Monday. */
export function firstJudgedWeek(startDate: string): string {
  const monday = weekStartForDay(startDate)
  return monday === startDate ? monday : shiftDateStr(monday, 7)
}

export function initialWalkingState(input: {
  startDate: string
  ownStepsGoal: number | null | undefined
  recentDailySteps: readonly number[]
  recentWeeklyMinutes: readonly number[]
  fallbackStepGoal: number
  minutesCeiling?: MinutesCeiling
}): WalkingPlanState {
  const ceiling = input.minutesCeiling ?? MINUTES_CEILING
  const steps = startingStepsTarget({ ownStepsGoal: input.ownStepsGoal, recentDailySteps: input.recentDailySteps, fallbackGoal: input.fallbackStepGoal })
  const minutes = startingMinutesTarget(input.recentWeeklyMinutes, ceiling)
  return {
    version: 1,
    startDate: input.startDate,
    stepsTarget: steps.target,
    minutesTarget: minutes.target,
    minutesCeiling: ceiling,
    startLevels: { steps: steps.target, minutes: minutes.target, stepsBasis: steps.basis, minutesBasis: minutes.basis },
    stepsStreak: 0,
    stepsMissStreak: 0,
    minutesMissStreak: 0,
    stepsLastMet: null,
    minutesLastMet: null,
    nextWeekToJudge: firstJudgedWeek(input.startDate),
    weeks: [],
  }
}

/** One day as the plan measures it. `steps` null means no reading (never shown as zero). */
export interface WalkingDayMeasure {
  date: string
  steps: number | null
  activeMinutes: number
  excluded: DayExclusion | null
}

/** One-seventh of the weekly minutes, in whole minutes: the day's share, and the walk's length. */
export function dailyMinutesShare(minutesTarget: number): number {
  return Math.ceil(minutesTarget / 7)
}

/** Whole number with thousands commas, without a locale (the app renders one way everywhere). */
function withCommas(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** The stored day's rationale: deterministic, never an AI string. */
export function walkingDayRationale(walkMinutes: number, stepsTarget: number): string {
  return `A brisk walk of ${walkMinutes} minutes, or ${withCommas(stepsTarget)} steps across the day. Either one marks the day done.`
}

export interface WalkingDayVerdict {
  stepsMet: boolean
  minutesMet: boolean
  /** Either share met, on a day that is not left out. */
  done: boolean
}

export function walkingDayVerdict(
  day: Pick<WalkingDayMeasure, 'steps' | 'activeMinutes' | 'excluded'>,
  targets: { stepsTarget: number; minutesTarget: number },
): WalkingDayVerdict {
  const stepsMet = day.steps != null && day.steps >= targets.stepsTarget
  const minutesMet = day.activeMinutes >= dailyMinutesShare(targets.minutesTarget)
  return { stepsMet, minutesMet, done: day.excluded == null && (stepsMet || minutesMet) }
}

/** A week's record at the levels in force. `days` may hold any of the week's dates; others are
 *  ignored, and a missing date simply has no reading. */
export function measureWeek(
  weekStart: string,
  days: readonly WalkingDayMeasure[],
  levels: { stepsTarget: number; minutesTarget: number },
): WalkingWeekRecord {
  const weekEnd = shiftDateStr(weekStart, 6)
  const inWeek = days.filter((d) => d.date >= weekStart && d.date <= weekEnd)
  const counted = inWeek.filter((d) => d.excluded == null)
  const excludedCount = inWeek.length - counted.length
  const countedDays = 7 - excludedCount
  const withSteps = counted.filter((d) => d.steps != null) as (WalkingDayMeasure & { steps: number })[]
  const stepDaysMet = withSteps.filter((d) => d.steps >= levels.stepsTarget).length
  const activeMinutes = counted.reduce((s, d) => s + d.activeMinutes, 0)
  return {
    weekStart,
    stepsTarget: levels.stepsTarget,
    minutesTarget: levels.minutesTarget,
    countedDays,
    stepDaysMet,
    meanSteps: withSteps.length > 0 ? Math.round(withSteps.reduce((s, d) => s + d.steps, 0) / withSteps.length) : null,
    activeMinutes,
    stepsMet: countedDays > 0 && stepDaysMet >= Math.min(STEPS_DAYS_TO_MEET_WEEK, countedDays),
    minutesMet: activeMinutes >= levels.minutesTarget,
    excluded: excludedCount >= 7,
  }
}

/** Judge one ended week and move the targets by the tables. Returns a new state. */
export function judgeWeek(
  state: WalkingPlanState,
  weekStart: string,
  days: readonly WalkingDayMeasure[],
  ctx: { ownStepsGoal: number | null | undefined },
): WalkingPlanState {
  const record = measureWeek(weekStart, days, { stepsTarget: state.stepsTarget, minutesTarget: state.minutesTarget })
  const next: WalkingPlanState = {
    ...state,
    nextWeekToJudge: shiftDateStr(weekStart, 7),
    weeks: [...state.weeks, record].slice(-WEEK_HISTORY_KEPT),
  }
  if (record.excluded) return next

  // Steps: two judged weeks in a row with 5+ days met at this level raise it by 500.
  const stepsStreak = record.stepsMet ? state.stepsStreak + 1 : 0
  if (record.stepsMet) next.stepsLastMet = state.stepsTarget
  if (stepsStreak >= STEPS_WEEKS_TO_GROW) {
    next.stepsTarget = Math.max(state.stepsTarget, Math.min(state.stepsTarget + STEPS_GROWTH, stepsCeiling(ctx.ownStepsGoal)))
    next.stepsStreak = 0
  } else {
    next.stepsStreak = stepsStreak
  }

  // Minutes: any week that met it raises it by 15.
  if (record.minutesMet) {
    next.minutesLastMet = state.minutesTarget
    next.minutesTarget = Math.max(state.minutesTarget, Math.min(state.minutesTarget + MINUTES_GROWTH, state.minutesCeiling))
  }

  const stepsMissed = record.meanSteps != null && record.meanSteps < (1 - STEP_BACK_MISS_SHARE) * state.stepsTarget
  const minutesMissed = record.activeMinutes < (1 - STEP_BACK_MISS_SHARE) * state.minutesTarget
  next.stepsMissStreak = stepsMissed ? state.stepsMissStreak + 1 : 0
  next.minutesMissStreak = minutesMissed ? state.minutesMissStreak + 1 : 0
  return next
}

/** True once `todayIso` is past the week's Sunday plus the grace days. */
function isFrozen(weekStart: string, todayIso: string): boolean {
  return todayIso >= shiftDateStr(weekStart, 7 + JUDGE_GRACE_DAYS)
}

/** The Mondays of the weeks whose grace has passed and are not yet frozen, oldest first. */
export function weeksToJudge(state: Pick<WalkingPlanState, 'nextWeekToJudge'>, todayIso: string): string[] {
  const out: string[] = []
  for (let w = state.nextWeekToJudge; isFrozen(w, todayIso); w = shiftDateStr(w, 7)) out.push(w)
  return out
}

/** The Mondays of the weeks that have ended but are still inside the grace, oldest first. */
export function weeksInGrace(state: Pick<WalkingPlanState, 'nextWeekToJudge'>, todayIso: string): string[] {
  const currentWeek = weekStartForDay(todayIso)
  const out: string[] = []
  for (let w = state.nextWeekToJudge; w < currentWeek; w = shiftDateStr(w, 7)) if (!isFrozen(w, todayIso)) out.push(w)
  return out
}

/**
 * One settle's judgement. `frozen` is the state to store: every week past its grace judged, each
 * once. `current` is what the plan asks for now: `frozen` with any week still inside its grace
 * judged on top, re-judged from the latest data on every call and marked `provisional`.
 * `days` must cover every week returned by `weeksToJudge` and `weeksInGrace`.
 */
export function settleWeeks(
  state: WalkingPlanState,
  days: readonly WalkingDayMeasure[],
  todayIso: string,
  ctx: { ownStepsGoal: number | null | undefined },
): { frozen: WalkingPlanState; current: WalkingPlanState; judged: string[] } {
  const judged = weeksToJudge(state, todayIso)
  let frozen = state
  for (const w of judged) frozen = judgeWeek(frozen, w, days, ctx)
  let current = frozen
  for (const w of weeksInGrace(frozen, todayIso)) {
    current = judgeWeek(current, w, days, ctx)
    const last = current.weeks.at(-1)!
    current = { ...current, weeks: [...current.weeks.slice(0, -1), { ...last, provisional: true }] }
  }
  return { frozen, current, judged }
}

export interface StepBackOffer {
  target: WalkingTarget
  from: number
  to: number
}

/** The step backs the plan offers now: a target missed by more than 25% two weeks running, with a
 *  lower level it met before. Never applied here. */
export function stepBackOffers(state: WalkingPlanState): StepBackOffer[] {
  const out: StepBackOffer[] = []
  if (state.stepsMissStreak >= STEP_BACK_WEEKS && state.stepsLastMet != null && state.stepsLastMet < state.stepsTarget) {
    out.push({ target: 'steps', from: state.stepsTarget, to: state.stepsLastMet })
  }
  if (state.minutesMissStreak >= STEP_BACK_WEEKS && state.minutesLastMet != null && state.minutesLastMet < state.minutesTarget) {
    out.push({ target: 'minutes', from: state.minutesTarget, to: state.minutesLastMet })
  }
  return out
}

/** The person accepted a step back. Null when none is on offer for that target. */
export function applyStepBack(state: WalkingPlanState, target: WalkingTarget): WalkingPlanState | null {
  const offer = stepBackOffers(state).find((o) => o.target === target)
  if (!offer) return null
  return target === 'steps'
    ? { ...state, stepsTarget: offer.to, stepsStreak: 0, stepsMissStreak: 0 }
    : { ...state, minutesTarget: offer.to, minutesMissStreak: 0 }
}

/** The person chose the minutes ceiling (150, or 300 for "heart health plus"). A lower ceiling than
 *  the current target brings the target down to it: that is the person's choice, not the plan's. */
export function setMinutesCeiling(state: WalkingPlanState, ceiling: MinutesCeiling): WalkingPlanState {
  return { ...state, minutesCeiling: ceiling, minutesTarget: Math.min(state.minutesTarget, ceiling) }
}

/** Reads a stored state back, or null when it is absent or not this shape (then it is rebuilt). */
export function parseWalkingState(raw: unknown): WalkingPlanState | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<WalkingPlanState>
  // Stored dates are dash-form local days; they are compared as strings, so a slash form is refused.
  const isDate = (v: unknown) => typeof v === 'string' && !v.includes('/') && isCalendarDate(v)
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (s.version !== 1 || !isDate(s.startDate) || !isDate(s.nextWeekToJudge)) return null
  if (!isNum(s.stepsTarget) || !isNum(s.minutesTarget) || !Array.isArray(s.weeks)) return null
  if (s.minutesCeiling !== MINUTES_CEILING && s.minutesCeiling !== MINUTES_CEILING_PLUS) return null
  if (!s.startLevels || !isNum(s.stepsStreak) || !isNum(s.stepsMissStreak) || !isNum(s.minutesMissStreak)) return null
  return s as WalkingPlanState
}
