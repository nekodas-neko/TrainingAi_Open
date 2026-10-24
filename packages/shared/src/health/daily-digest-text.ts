// The end-of-day digest, written from the facts the route assembled (#3286).
//
// `/api/daily-digest` built every figure below before it called a model, then asked for two or
// three warm sentences quoting them. The model was never allowed to compute or invent a number, so
// its contribution was phrasing, on every open of the review. This renders the same facts in plain
// words. It gives no advice: a sparse-logging day states how thin the history is rather than
// telling anyone to eat more or less.

export interface DigestFacts {
  /** The session trained today, or null on a rest day. */
  training: { name: string; exercises: number; volumeKg: number } | null
  /** Personal records already described for display (`describePersonalRecord`), not raw numbers. */
  prs: string[]
  nutrition: {
    kcal: number
    /** The day's budget, null when it could not be read. */
    budgetKcal: number | null
    proteinG: number
    proteinTargetG: number | null
    /** Projected kg/week at today's rate, null without a budget. */
    weeklyKg: number | null
    loggedDays: number
    windowDays: number
    /** True when `loggedDays` is under the shared coverage floor. */
    sparse: boolean
  } | null
  steps: { today: number; dailyGoal: number } | { today: number; weeklyTarget: number; pacePerDay: number } | null
  checkin: { tiredness: number | null; soreMuscles: string[] } | null
  phase: { name: string; cycleInPhase: number; totalPhaseCycles: number } | null
}

const n0 = (n: number) => Math.round(n).toLocaleString('en-US')

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** True when the day has nothing to report at all, so the caller returns no digest. */
export function digestHasNothing(f: DigestFacts): boolean {
  return f.training == null && f.nutrition == null && f.checkin == null && f.prs.length === 0
}

export function buildDailyDigestText(f: DigestFacts): string {
  const out: string[] = []

  // Training and what came of it.
  const training = f.training
    ? `You trained ${f.training.name} today: ${f.training.exercises} exercise${f.training.exercises === 1 ? '' : 's'}, ${n0(f.training.volumeKg)} kg of volume.`
    : 'Today was a rest day, with no training logged.'
  out.push(f.prs.length > 0 ? `${training} New records: ${joinList(f.prs)}.` : training)

  if (f.phase) {
    const left = f.phase.totalPhaseCycles - f.phase.cycleInPhase
    out.push(left > 0
      ? `That was session ${f.phase.cycleInPhase} of ${f.phase.totalPhaseCycles} in the ${f.phase.name} phase, with ${left} more session${left === 1 ? '' : 's'} before the next one.`
      : `That was the last session of the ${f.phase.name} phase.`)
  }

  const nu = f.nutrition
  if (nu) {
    const kcal = nu.budgetKcal != null
      ? `${n0(nu.kcal)} of your ${n0(nu.budgetKcal)} kcal budget`
      : `${n0(nu.kcal)} kcal`
    const protein = nu.proteinTargetG != null
      ? `${n0(nu.proteinG)} g of ${n0(nu.proteinTargetG)} g protein`
      : `${n0(nu.proteinG)} g protein`
    let s = `You have eaten ${kcal} and ${protein}.`
    if (nu.weeklyKg != null) {
      s += ` At today's rate that is ${nu.weeklyKg > 0 ? '+' : ''}${nu.weeklyKg.toFixed(2)} kg a week.`
    }
    if (nu.sparse) {
      s += ` Only ${nu.loggedDays} of the last ${nu.windowDays} days have food logged, so one day's totals say little about a trend.`
    }
    out.push(s)
  }

  if (f.steps) {
    out.push('dailyGoal' in f.steps
      ? `Steps: ${n0(f.steps.today)} of ${n0(f.steps.dailyGoal)}.`
      : f.steps.pacePerDay > 0
        ? `Steps: ${n0(f.steps.today)} today; about ${n0(f.steps.pacePerDay)} a day for the rest of the week reaches your ${n0(f.steps.weeklyTarget)} weekly goal.`
        : `Steps: ${n0(f.steps.today)} today, and your ${n0(f.steps.weeklyTarget)} weekly goal is already met.`)
  }

  if (f.checkin) {
    const bits: string[] = []
    if (f.checkin.tiredness != null) bits.push(`tiredness ${f.checkin.tiredness}/5`)
    if (f.checkin.soreMuscles.length > 0) bits.push(`sore ${joinList(f.checkin.soreMuscles)}`)
    if (bits.length > 0) out.push(`This morning you logged ${joinList(bits)}.`)
  }

  return out.join(' ')
}
