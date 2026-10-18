// #2986 — tune against Oura: our scores next to Oura's, and what Oura's scores are made of. READ-ONLY.
//
// Oura's top-level scores are the target here, never an input (rule 5 on #2860, and section 1 of
// `docs/architecture/scoring-layers-and-data-inputs.md`). This module is the only place they meet
// ours. It is pure: the CLI (`tune-against-oura-cli.ts`) reads the rows and prints what this returns.
//
// Pairing, and which side each date comes from:
//   - Oura dates a night by the day you wake (`daily_sleep.day`, `daily_readiness.day`). So do we:
//     `shadow_readiness.date`, `oura_daily_derived.day` and `sleep_sessions.date` are wake dates. A
//     sleep or readiness day counts only when Oura's main sleep period for that day and our canonical
//     night for that date overlap by at least half of the shorter one, so both scores read one night.
//   - Oura's activity day runs 4 a.m. to 4 a.m. local. Our Activity pillar on readiness date D reads
//     the day before it (its units' `daytimeThrough`), so Oura's activity day A pairs with our row for
//     A + 1, and only when an activity unit on that row says it read A. Our day is midnight to
//     midnight, so the four hours after midnight fall on different days; the report says so.
//   - An Oura score counts only where `oura_daily.source_map` says `oura_cloud`: the ring's own BLE
//     values outrank Oura's per field, and a number our rollup wrote is not Oura's.
import { spearman } from '@trainingai/shared/health/correlation'
import { canonicalNightForDate, nightSessions } from '@trainingai/shared/health/sleep-night'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { PILLAR_WEIGHTS, UNIT_DEFS, type ShadowUnitId } from '@trainingai/shared/health/shadow-readiness/model'
import { READINESS_WEIGHTS } from '@trainingai/shared/health/readiness-composite'
import { SLEEP_WEIGHTS, sleepComponentsToContributors } from '@trainingai/shared/health/sleep-score'

/** Below this many paired days a fit is reported as not yet meaningful (#2986). */
export const MIN_FIT_DAYS = 14

/** A night counts as the same night when the two windows overlap by this share of the shorter. */
export const SAME_NIGHT_MIN_OVERLAP = 0.5

/** Oura's sleep types that make up the night its daily sleep score reads. */
const OURA_MAIN_SLEEP_TYPES = new Set(['long_sleep'])

export interface OuraDailyRow {
  date: string
  readinessScore: number | null
  sleepScore: number | null
  activityScore: number | null
  sourceMap: Record<string, string> | null
}

export interface OuraCloudDailyRow {
  date: string
  readinessContributors: Record<string, number | null> | null
  sleepContributors: Record<string, number | null> | null
  activityContributors: Record<string, number | null> | null
}

export interface OuraSleepPeriodRow {
  day: string
  bedtimeStart: Date | null
  bedtimeEnd: Date | null
  sleepType: string | null
}

export interface OurSleepRow {
  date: string
  sleepStart: Date
  sleepEnd: Date
  durationHours: number | null
}

export interface DerivedRow {
  day: string
  sleepScore: number | null
  sleepContributors: Record<string, unknown> | null
  readinessScore: number | null
  readinessContributors: Record<string, unknown> | null
}

export interface ShadowUnitStored {
  score: number | null
  daytimeThrough?: string | null
}

export interface ShadowRow {
  date: string
  modelVersion: number
  shadowReadiness: number | null
  sleepPillar: number | null
  heartPillar: number | null
  activityPillar: number | null
  bodyPillar: number | null
  units: Record<string, ShadowUnitStored> | null
}

export interface TuneInput {
  tz: string
  /** Oura dates, inclusive. */
  from: string
  to: string
  ouraDaily: OuraDailyRow[]
  ouraCloudDaily: OuraCloudDailyRow[]
  ouraSleepPeriods: OuraSleepPeriodRow[]
  sleepSessions: OurSleepRow[]
  derived: DerivedRow[]
  shadow: ShadowRow[]
  /** Which shadow model to read. Defaults to the newest version stored in the range. */
  shadowModelVersion?: number
}

// ── Statistics ──────────────────────────────────────────────────────────────────────────────────

export interface DiffSummary {
  n: number
  /** Mean of ours − Oura's, in points. */
  meanDiff: number | null
  /** Sample standard deviation of ours − Oura's. */
  sdDiff: number | null
  /** Spearman rank correlation. */
  rho: number | null
}

export function summarizeDiff(pairs: readonly { ours: number; oura: number }[]): DiffSummary {
  const n = pairs.length
  if (n === 0) return { n, meanDiff: null, sdDiff: null, rho: null }
  const diffs = pairs.map(p => p.ours - p.oura)
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n
  const sdDiff = n > 1 ? Math.sqrt(diffs.reduce((a, d) => a + (d - meanDiff) ** 2, 0) / (n - 1)) : null
  return { n, meanDiff, sdDiff, rho: spearman(pairs.map(p => ({ x: p.ours, y: p.oura }))) }
}

/** Euclidean projection onto { w ≥ 0, Σw = 1 } (Held, Wolfe and Crowder; Duchi et al. 2008). */
function projectToSimplex(v: readonly number[]): number[] {
  const u = [...v].sort((a, b) => b - a)
  let cum = 0
  let theta = 0
  for (let i = 0; i < u.length; i++) {
    cum += u[i]
    const t = (cum - 1) / (i + 1)
    if (u[i] - t > 0) theta = t
  }
  return v.map(x => Math.max(0, x - theta))
}

export interface SimplexFit {
  weights: number[]
  /** 1 − SS_res / SS_tot around the target's mean; null when the target is constant. */
  r2: number | null
  /** Root-mean-square residual, in points. */
  rmse: number
}

/**
 * Least squares with non-negative weights that sum to 1, and no intercept: `y ≈ X·w`. With every
 * column a 0–100 score and the target one too, the weights read as shares of the target, which is
 * what "what Oura deemed important" asks. Solved by accelerated projected gradient (FISTA), which is
 * exact enough for a handful of columns and needs no linear-algebra package.
 */
export function fitSimplexWeights(X: readonly (readonly number[])[], y: readonly number[]): SimplexFit {
  const n = X.length
  const k = X[0]?.length ?? 0
  if (n === 0 || k === 0) throw new Error('fitSimplexWeights needs at least one row and one column')
  const G = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)))
  const b = Array.from({ length: k }, (_, i) => X.reduce((s, r, t) => s + r[i] * y[t], 0))

  // Step 1/L with L the largest eigenvalue of G, by power iteration; padded so the step stays safe.
  let v = Array(k).fill(1 / Math.sqrt(k))
  let L = 0
  for (let it = 0; it < 500; it++) {
    const gv = G.map(row => row.reduce((s, g, j) => s + g * v[j], 0))
    const norm = Math.sqrt(gv.reduce((s, x) => s + x * x, 0))
    if (norm === 0) break
    L = norm
    v = gv.map(x => x / norm)
  }
  const step = 1 / (L * 1.01 || 1)

  let w = Array(k).fill(1 / k)
  let z = [...w]
  let t = 1
  for (let it = 0; it < 200_000; it++) {
    const grad = G.map((row, i) => row.reduce((s, g, j) => s + g * z[j], 0) - b[i])
    const next = projectToSimplex(z.map((zi, i) => zi - step * grad[i]))
    const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2
    z = next.map((ni, i) => ni + ((t - 1) / tNext) * (ni - w[i]))
    const moved = Math.max(...next.map((ni, i) => Math.abs(ni - w[i])))
    w = next
    t = tNext
    if (moved < 1e-13) break
  }

  const fitted = X.map(r => r.reduce((s, x, j) => s + x * w[j], 0))
  const mean = y.reduce((a, c) => a + c, 0) / n
  const ssRes = y.reduce((s, yi, i) => s + (yi - fitted[i]) ** 2, 0)
  const ssTot = y.reduce((s, yi) => s + (yi - mean) ** 2, 0)
  return { weights: w, r2: ssTot > 0 ? 1 - ssRes / ssTot : null, rmse: Math.sqrt(ssRes / n) }
}

// ── Fits ────────────────────────────────────────────────────────────────────────────────────────

export interface FitRow {
  date: string
  /** The Oura score; null when that day has none. */
  target: number | null
  /** Why `target` is null, when the caller knows better than "no Oura score". */
  noTarget?: string
  features: Record<string, number | null> | null
}

export interface FitWeight {
  name: string
  fitted: number
  /** Our current weight for the same input, renormalised over the inputs this fit kept. */
  ours: number | null
}

export interface FitResult {
  label: string
  daysOffered: number
  daysUsed: number
  dropped: Record<string, number>
  /** Inputs left out because they were missing on more than half the days with a target. */
  droppedInputs: { name: string; missingDays: number }[]
  meaningful: boolean
  weights: FitWeight[] | null
  r2: number | null
  rmse: number | null
}

/**
 * Fits one Oura score against a set of inputs. An input missing on more than half the days that
 * have a target is left out, then a day missing any input that stayed is dropped; both are counted.
 * Below {@link MIN_FIT_DAYS} days the fit is not run.
 */
export function fitAgainst(label: string, rows: readonly FitRow[], ourWeights?: Record<string, number>): FitResult {
  const dropped: Record<string, number> = {}
  const bump = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1 }
  const withTarget = rows.filter(r => {
    if (r.target == null) { bump(r.noTarget ?? 'no Oura score'); return false }
    if (r.features == null) { bump('no inputs stored'); return false }
    return true
  })

  const names = [...new Set(withTarget.flatMap(r => Object.keys(r.features!)))].sort()
  const missing = (name: string) => withTarget.filter(r => !Number.isFinite(r.features![name] as number)).length
  const droppedInputs = names.map(name => ({ name, missingDays: missing(name) })).filter(d => d.missingDays * 2 > withTarget.length)
  const kept = names.filter(n => !droppedInputs.some(d => d.name === n))

  const used = withTarget.filter(r => {
    if (kept.length > 0 && kept.every(n => Number.isFinite(r.features![n] as number))) return true
    bump('an input missing')
    return false
  })

  const base = { label, daysOffered: rows.length, daysUsed: used.length, dropped, droppedInputs }
  if (used.length < MIN_FIT_DAYS || kept.length === 0) return { ...base, meaningful: false, weights: null, r2: null, rmse: null }

  const fit = fitSimplexWeights(used.map(r => kept.map(n => r.features![n] as number)), used.map(r => r.target!))
  let oursTotal = 0
  if (ourWeights) for (const n of kept) oursTotal += ourWeights[n] ?? 0
  const weights = kept.map((name, i) => ({
    name,
    fitted: fit.weights[i],
    ours: ourWeights && oursTotal > 0 ? (ourWeights[name] ?? 0) / oursTotal : null,
  }))
  return { ...base, meaningful: true, weights, r2: fit.r2, rmse: fit.rmse }
}

// ── Pairing ─────────────────────────────────────────────────────────────────────────────────────

export interface PairedDay {
  ouraDate: string
  ourDate: string
  oura: number
  ours: number
}

export interface Comparison {
  label: string
  /** Which side each date comes from, in words. */
  dates: string
  days: PairedDay[]
  dropped: Record<string, number>
  summary: DiffSummary
}

/** Every date from `from` to `to` inclusive, by day count (never a `d <= end` loop). */
export function datesInRange(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
  if (!(days >= 0)) return []
  return Array.from({ length: days + 1 }, (_, i) => shiftDateStr(from, i))
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

type OuraScoreCol = 'readiness_score' | 'sleep_score' | 'activity_score'
const OURA_SCORE_PROP: Record<OuraScoreCol, 'readinessScore' | 'sleepScore' | 'activityScore'> = {
  readiness_score: 'readinessScore', sleep_score: 'sleepScore', activity_score: 'activityScore',
}

/** Oura's own score for a day, or why there is none. */
function ouraScore(row: OuraDailyRow | undefined, col: OuraScoreCol): number | string {
  const value = num(row?.[OURA_SCORE_PROP[col]])
  if (value == null) return 'no Oura score'
  if (row?.sourceMap?.[col] !== 'oura_cloud') return 'score not from Oura'
  return value
}

interface Context {
  ouraByDate: Map<string, OuraDailyRow>
  cloudByDate: Map<string, OuraCloudDailyRow>
  derivedByDay: Map<string, DerivedRow>
  shadowByDate: Map<string, ShadowRow>
  /** Wake date → why the night check fails, or null when Oura and we read the same night. */
  nightCheck: (date: string) => string | null
  shadowVersion: number | null
  shadowOtherVersions: number
}

function buildContext(input: TuneInput): Context {
  const nights = nightSessions(input.sleepSessions.map(s => ({ ...s })), input.tz)
  const periodsByDay = new Map<string, OuraSleepPeriodRow[]>()
  for (const p of input.ouraSleepPeriods) {
    if (!OURA_MAIN_SLEEP_TYPES.has(p.sleepType ?? '') || !p.bedtimeStart || !p.bedtimeEnd) continue
    periodsByDay.set(p.day, [...(periodsByDay.get(p.day) ?? []), p])
  }
  const nightCheck = (date: string): string | null => {
    const theirs = (periodsByDay.get(date) ?? [])
      .sort((a, b) => (b.bedtimeEnd!.getTime() - b.bedtimeStart!.getTime()) - (a.bedtimeEnd!.getTime() - a.bedtimeStart!.getTime()))[0]
    if (!theirs) return 'no Oura sleep period to confirm the night'
    const ours = canonicalNightForDate(nights, date, input.tz)
    if (!ours) return 'no night of ours'
    const overlap = Math.min(ours.sleepEnd.getTime(), theirs.bedtimeEnd!.getTime()) - Math.max(ours.sleepStart.getTime(), theirs.bedtimeStart!.getTime())
    const shorter = Math.min(ours.sleepEnd.getTime() - ours.sleepStart.getTime(), theirs.bedtimeEnd!.getTime() - theirs.bedtimeStart!.getTime())
    return shorter > 0 && overlap >= SAME_NIGHT_MIN_OVERLAP * shorter ? null : 'different nights'
  }

  const versions = [...new Set(input.shadow.map(s => s.modelVersion))]
  const shadowVersion = input.shadowModelVersion ?? (versions.length ? Math.max(...versions) : null)
  const shadowRows = input.shadow.filter(s => s.modelVersion === shadowVersion)
  return {
    ouraByDate: new Map(input.ouraDaily.map(r => [r.date, r])),
    cloudByDate: new Map(input.ouraCloudDaily.map(r => [r.date, r])),
    derivedByDay: new Map(input.derived.map(r => [r.day, r])),
    shadowByDate: new Map(shadowRows.map(r => [r.date, r])),
    nightCheck,
    shadowVersion,
    shadowOtherVersions: input.shadow.length - shadowRows.length,
  }
}

interface Side {
  /** Our date for an Oura date. */
  ourDate: (ouraDate: string) => string
  /** Our value for that date, or why there is none. */
  ours: (ourDate: string, ouraDate: string) => number | string
  /** A second check both sides must pass, e.g. the same night; null when it passes. */
  check?: (ouraDate: string) => string | null
}

function pair(dates: readonly string[], label: string, datesNote: string, col: OuraScoreCol, ctx: Context, side: Side): Comparison {
  const days: PairedDay[] = []
  const dropped: Record<string, number> = {}
  for (const ouraDate of dates) {
    const oura = ouraScore(ctx.ouraByDate.get(ouraDate), col)
    const ourDate = side.ourDate(ouraDate)
    const ours = side.ours(ourDate, ouraDate)
    const why = typeof oura === 'string' ? oura : typeof ours === 'string' ? ours : side.check?.(ouraDate) ?? null
    if (why != null) { dropped[why] = (dropped[why] ?? 0) + 1; continue }
    days.push({ ouraDate, ourDate, oura: oura as number, ours: ours as number })
  }
  return { label, dates: datesNote, days, dropped, summary: summarizeDiff(days) }
}

const SLEEP_NOTE = 'both dates are the wake date; the night is confirmed against Oura\'s main sleep period'
const ACTIVITY_NOTE = 'Oura\'s activity day A (4 a.m. to 4 a.m.) against our readiness row for A + 1, whose Activity units read A (midnight to midnight)'

const shadowUnitScore = (row: ShadowRow | undefined, id: string) => num(row?.units?.[id]?.score)

/** True when an activity unit on this shadow row read the given day. */
function activityReadDay(row: ShadowRow, day: string): boolean {
  return Object.entries(row.units ?? {}).some(([id, u]) => id.startsWith('activity.') && u?.daytimeThrough === day)
}

/** A readiness contributor's score, or null when it fell back to the neutral 50. */
function readinessInput(stored: unknown): number | null {
  if (stored == null || typeof stored !== 'object') return null
  const c = stored as { score?: unknown; provisional?: unknown }
  return c.provisional === true ? null : num(c.score)
}

function contributorsAsNumbers(stored: Record<string, unknown> | null | undefined): Record<string, number | null> | null {
  if (!stored || typeof stored !== 'object') return null
  return Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, num(v)]))
}

const unitIds = (pillar: string) => (Object.keys(UNIT_DEFS) as ShadowUnitId[]).filter(id => UNIT_DEFS[id].pillar === pillar)
const unitWeights = (pillar: string) => Object.fromEntries(unitIds(pillar).map(id => [id, UNIT_DEFS[id].weight]))
const unitFeatures = (row: ShadowRow | undefined, pillar: string) =>
  row ? Object.fromEntries(unitIds(pillar).map(id => [id, shadowUnitScore(row, id)])) : null

export interface TuneReport {
  from: string
  to: string
  tz: string
  shadowVersion: number | null
  shadowOtherVersions: number
  comparisons: Comparison[]
  ouraFits: FitResult[]
  ourFits: FitResult[]
}

export function buildTuneReport(input: TuneInput): TuneReport {
  const ctx = buildContext(input)
  const dates = datesInRange(input.from, input.to)
  const same = (d: string) => d
  const nextDay = (d: string) => shiftDateStr(d, 1)
  const fromShadow = (get: (r: ShadowRow) => number | null) => (ourDate: string) => {
    const row = ctx.shadowByDate.get(ourDate)
    if (!row) return 'no shadow row of ours'
    return get(row) ?? 'no score of ours'
  }
  const fromDerived = (get: (r: DerivedRow) => number | null) => (ourDate: string) => {
    const row = ctx.derivedByDay.get(ourDate)
    return (row && get(row)) ?? 'no score of ours'
  }
  const activityCheck = (ouraDate: string) => {
    const row = ctx.shadowByDate.get(nextDay(ouraDate))
    return row && activityReadDay(row, ouraDate) ? null : 'our Activity pillar did not read that day'
  }

  const sleepPillar = pair(dates, 'Sleep pillar vs Oura sleep', SLEEP_NOTE, 'sleep_score', ctx,
    { ourDate: same, ours: fromShadow(r => num(r.sleepPillar)), check: ctx.nightCheck })
  const sleepScore = pair(dates, 'Our sleep score vs Oura sleep', SLEEP_NOTE, 'sleep_score', ctx,
    { ourDate: same, ours: fromDerived(r => num(r.sleepScore)), check: ctx.nightCheck })
  const readiness = pair(dates, 'Our readiness vs Oura readiness', SLEEP_NOTE, 'readiness_score', ctx,
    { ourDate: same, ours: fromDerived(r => num(r.readinessScore)), check: ctx.nightCheck })
  const shadowReadiness = pair(dates, 'Shadow readiness vs Oura readiness', SLEEP_NOTE, 'readiness_score', ctx,
    { ourDate: same, ours: fromShadow(r => num(r.shadowReadiness)), check: ctx.nightCheck })
  const activityPillar = pair(dates, 'Activity pillar vs Oura activity', ACTIVITY_NOTE, 'activity_score', ctx,
    { ourDate: nextDay, ours: fromShadow(r => num(r.activityPillar)), check: activityCheck })

  // What Oura weights: each Oura score against Oura's own contributors for the same Oura day.
  const ouraFit = (label: string, col: OuraScoreCol, pick: (r: OuraCloudDailyRow) => Record<string, number | null> | null) =>
    fitAgainst(label, dates.map(d => {
      const score = ouraScore(ctx.ouraByDate.get(d), col)
      const cloud = ctx.cloudByDate.get(d)
      if (typeof score === 'string') return { date: d, target: null, noTarget: score, features: null }
      return { date: d, target: score, features: cloud ? contributorsAsNumbers(pick(cloud)) : null }
    }))
  const ouraFits = [
    ouraFit('Oura readiness ~ Oura\'s readiness contributors', 'readiness_score', r => r.readinessContributors),
    ouraFit('Oura sleep ~ Oura\'s sleep contributors', 'sleep_score', r => r.sleepContributors),
    ouraFit('Oura activity ~ Oura\'s activity contributors', 'activity_score', r => r.activityContributors),
  ]

  // What explains Oura from our side: the days each comparison paired, against our inputs.
  const onPaired = (cmp: Comparison, features: (p: PairedDay) => Record<string, number | null> | null): FitRow[] =>
    cmp.days.map(p => ({ date: p.ouraDate, target: p.oura, features: features(p) }))
  const ourSleepWeights = sleepComponentsToContributors({ ...SLEEP_WEIGHTS })
  const readinessKeys = Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[]
  const ourFits = [
    fitAgainst('Oura sleep ~ our Sleep units (shadow)', onPaired(sleepPillar, p => unitFeatures(ctx.shadowByDate.get(p.ourDate), 'sleep')), unitWeights('sleep')),
    fitAgainst('Oura sleep ~ our sleep score contributors', onPaired(sleepScore, p => contributorsAsNumbers(ctx.derivedByDay.get(p.ourDate)?.sleepContributors)), ourSleepWeights),
    fitAgainst('Oura readiness ~ our readiness\'s 8 inputs', onPaired(readiness, p => {
      const stored = ctx.derivedByDay.get(p.ourDate)?.readinessContributors
      return stored ? Object.fromEntries(readinessKeys.map(k => [k, readinessInput(stored[k])])) : null
    }), { ...READINESS_WEIGHTS }),
    fitAgainst('Oura readiness ~ our pillars (shadow)', onPaired(shadowReadiness, p => {
      const row = ctx.shadowByDate.get(p.ourDate)
      return row ? { sleep: num(row.sleepPillar), heart: num(row.heartPillar), activity: num(row.activityPillar), body: num(row.bodyPillar) } : null
    }), { ...PILLAR_WEIGHTS }),
    fitAgainst('Oura activity ~ our Activity units (shadow)', onPaired(activityPillar, p => unitFeatures(ctx.shadowByDate.get(p.ourDate), 'activity')), unitWeights('activity')),
  ]

  return {
    from: input.from, to: input.to, tz: input.tz,
    shadowVersion: ctx.shadowVersion, shadowOtherVersions: ctx.shadowOtherVersions,
    comparisons: [sleepPillar, sleepScore, readiness, shadowReadiness, activityPillar],
    ouraFits, ourFits,
  }
}

// ── Text ────────────────────────────────────────────────────────────────────────────────────────

const f1 = (v: number | null) => (v == null ? '—' : v.toFixed(1))
const f2 = (v: number | null) => (v == null ? '—' : v.toFixed(2))
const signed = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`)
const droppedText = (dropped: Record<string, number>) => {
  const parts = Object.entries(dropped).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${n} ${why}`)
  return parts.length ? parts.join(', ') : 'none'
}

function fitLines(fit: FitResult): string[] {
  const lines = [`  ${fit.label}`, `    days used ${fit.daysUsed} of ${fit.daysOffered}; dropped: ${droppedText(fit.dropped)}`]
  for (const d of fit.droppedInputs) lines.push(`    left out ${d.name}: missing on ${d.missingDays} days`)
  if (!fit.meaningful || !fit.weights) {
    lines.push(`    not yet meaningful: ${fit.daysUsed} paired days, a fit needs ${MIN_FIT_DAYS}`)
    return lines
  }
  lines.push(`    R² ${f2(fit.r2)}, RMSE ${f1(fit.rmse)} points`)
  const width = Math.max(...fit.weights.map(w => w.name.length))
  const hasOurs = fit.weights.some(w => w.ours != null)
  lines.push(`    ${'input'.padEnd(width)}  fitted${hasOurs ? '   ours' : ''}`)
  for (const w of [...fit.weights].sort((a, b) => b.fitted - a.fitted)) {
    lines.push(`    ${w.name.padEnd(width)}  ${w.fitted.toFixed(2).padStart(6)}${hasOurs ? `  ${(w.ours == null ? '—' : w.ours.toFixed(2)).padStart(5)}` : ''}`)
  }
  return lines
}

/** The report as lines of text. `perDay` adds every paired day's numbers. */
export function formatTuneReport(report: TuneReport, opts: { perDay?: boolean } = {}): string[] {
  const out: string[] = []
  out.push(`Tune against Oura — Oura dates ${report.from} to ${report.to}, timezone ${report.tz}`)
  out.push(`Shadow model version ${report.shadowVersion ?? 'none stored'}${report.shadowOtherVersions ? ` (${report.shadowOtherVersions} rows of other versions ignored)` : ''}`)
  out.push('Oura\'s scores are the reference here, never an input. Ours − Oura\'s is the difference.')
  out.push('')
  out.push('1. Side by side')
  for (const c of report.comparisons) {
    const s = c.summary
    out.push(`  ${c.label}`)
    out.push(`    dates: ${c.dates}`)
    out.push(`    days used ${s.n}; dropped: ${droppedText(c.dropped)}`)
    out.push(`    mean difference ${signed(s.meanDiff)}, spread (SD) ${f1(s.sdDiff)}, rank correlation ${f2(s.rho)}`)
    if (s.n < MIN_FIT_DAYS) out.push(`    not yet meaningful: ${s.n} paired days, ${MIN_FIT_DAYS} needed`)
    if (opts.perDay) {
      out.push('    Oura date   our date    Oura   ours   diff')
      for (const d of c.days) {
        out.push(`    ${d.ouraDate}  ${d.ourDate}  ${f1(d.oura).padStart(5)}  ${f1(d.ours).padStart(5)}  ${signed(d.ours - d.oura).padStart(5)}`)
      }
    }
  }
  out.push('')
  out.push('2. What Oura weights (non-negative weights summing to 1, no intercept)')
  out.push('  With no intercept, an input that barely moves can soak up a fixed offset between the two scales.')
  for (const fit of report.ouraFits) out.push(...fitLines(fit))
  out.push('')
  out.push('3. What explains Oura from our side (ours = our current weight, renormalised over the inputs kept)')
  for (const fit of report.ourFits) out.push(...fitLines(fit))
  return out
}
