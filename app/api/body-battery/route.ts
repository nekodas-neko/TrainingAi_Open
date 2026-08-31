import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, shiftDateStr, ageFromDob } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { tryEnsureServerOuraConstants } from '@/lib/oura-models/constants-inject'
import { hrMaxFromAge, hrReserve, HR_REST_THRESHOLD } from '@trainingai/shared/health/hr-zones'
import { computeObservedHr } from '@trainingai/shared/health/observed-hr'
import { resolveBatteryHrMax, batteryConfidence, HR_PEAK_WINDOW_DAYS, type BatteryConfidence } from '@trainingai/shared/health/body-battery-inputs'
import { computeSleepScore, sleepScoreBaselines } from '@trainingai/shared/health/sleep-score'
import type { BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { walkBodyBattery } from '@trainingai/shared/health/body-battery-walk'
import { buildDaytimeStressSeriesFromModel, summarizeStressDay, type StressPoint, type DhrvBaselines } from '@/lib/health/daytime-stress'
import { resolveAnchor, type AnchorSource } from './anchor'
import { buildReadinessPayload } from '@/lib/health/readiness-payload'

export interface BodyBatteryPoint {
  t: number   // epoch ms
  v: number   // battery 0–100
}

export interface BodyBatteryResponse {
  current: number
  label: BodyBatteryLabel
  trend: 'charging' | 'draining' | 'steady'
  anchor: number
  anchorSource: 'readiness' | 'sleep' | 'default'
  /** True while the anchor is still the pre-readiness fallback and may be replaced today. The
   *  curve is real, but the level it starts from is not settled — the UI says so rather than
   *  presenting a number that will move on its own. */
  anchorProvisional: boolean
  charged: number   // total points gained since wake
  drained: number   // total points lost since wake
  wakeTime: number | null   // epoch ms
  series: BodyBatteryPoint[]
  hasData: boolean          // true when real HR drove the arc
  /** Whether the HR series was dense enough for the day's arc to describe the body rather than
   *  the sensor. `hasData` says samples exist; this says there were enough of them. */
  confidence: BatteryConfidence
  /** The reserve ceiling the walk actually used, and where it came from. */
  hrMax: { value: number; source: 'observed' | 'estimated'; observedPeak: number | null; peakDays: number }
  // Daytime-stress contribution (dHRV-based). null when there wasn't enough daytime signal to run it.
  stress: {
    current: number | null  // latest bucket's stress level, [−1,+1] (negative = stressed)
    draining: boolean       // stress is currently adding drain
    extraDrained: number    // battery points drained by stress since wake
    series: { t: number; level: number }[]  // 30-min bucket midpoints, level ∈ [−1,+1]
    highMinutes: number | null              // minutes at level ≤ STRESS_HIGH_LEVEL today
  } | null
}

// ── Tuning constants ─────────────────────────────────────────────────────────
// Battery is anchored at the morning readiness score and walked forward minute
// by minute off the heart-rate series. Below REST_THRESHOLD of HR reserve the
// tank charges; above it, it drains in proportion to intensity.
// HR_REST_THRESHOLD (lib/health/hr-zones.ts) — the reserve fraction at/under which we recharge
// (awake sitting HR sits ~0.05–0.10 of reserve, so only genuine low-HR rest charges;
//  ordinary waking activity holds steady or drains gently). Shared with the Activity score's
// "moved this hour" signal (lib/health/hourly-movement.ts) — one rest/active boundary, not two.
const REST_THRESHOLD = HR_REST_THRESHOLD
// Halved from 0.40 on 2026-08-04 (Q-57). At 0.40 a nominal eight hours of true resting HR charged
// 192 points against a 100-point scale, and across 36 measured production days the battery ended
// above 80 on 18 of them with 14 pinned at the ceiling — a tank that is always full carries no
// information. Backtested over the same days with the corrected HRmax below: 0.20 is the highest
// rate that pins no day at 100, and lands the end-of-day distribution around 50 rather than 72.
const CHARGE_RATE    = 0.20   // battery points per minute at full rest
const DRAIN_RATE     = 0.60   // battery points per minute per unit reserve over threshold
const GAP_HOLD_MIN   = 30     // gaps longer than this hold steady (ring not worn)
const SAMPLE_CAP_MIN = 7      // clamp per-sample dt so sparse data can't spike a delta
// Extra drain from daytime stress (dHRV below your daytime norm), added on top of the HR delta —
// so stress depletes the tank even at rest. Scaled by how far below baseline the moment's dHRV is.
const STRESS_DRAIN_RATE = 0.2 // battery points per minute at a full (100%) below-baseline deviation

// Stamped onto every daily snapshot so tuning analysis never mixes data from
// different constant sets. Bump this whenever the constants above change.
// v5 (2026-08-04, Q-57): charge rate halved and HRmax resolved from observed daily peaks rather
// than 220 − age. `hrmax-observed` is in the string because the reserve now varies per user and
// per window — two days on v5 are not comparable if one fell back to the age estimate.
const MODEL_VERSION = `v5:rest${REST_THRESHOLD}:chg${CHARGE_RATE}:drn${DRAIN_RATE}:str${STRESS_DRAIN_RATE}:hrmax-observed:oura-rule`

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function labelFor(v: number): BodyBatteryResponse['label'] {
  if (v >= 75) return 'Charged'
  if (v >= 50) return 'Good'
  if (v >= 25) return 'Low'
  return 'Drained'
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:body-battery`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    return await buildBodyBattery(userId, session.user?.timezone ?? DEFAULT_TZ)
  } catch (err) {
    // This route 500'd in production on 2026-08-03 and left no trace: it had no catch, so nothing
    // reached error_events and there was no stack to work from. It reproduces on neither the seeded
    // local DB nor any test. Reporting is the only way the next occurrence is diagnosable.
    reportServerError(err, { userId, url: '/api/body-battery' })
    return NextResponse.json({ error: 'Body battery unavailable' }, { status: 500 })
  }
}

async function buildBodyBattery(userId: string, tz: string) {
  const repo = await getRepository()
  const now = new Date()
  const todayIso  = todayInTz(tz)
  const todayMid  = todayMidnightUtc(tz)
  const from28dIso = shiftDateStr(todayIso, -28)
  const yesterdayIso = shiftDateStr(todayIso, -1)
  const fromPeakWindowIso = shiftDateStr(todayIso, -HR_PEAK_WINDOW_DAYS)

  const [ouraRows, derivedRows, bodyMetrics, sleepSessions, hrRows, user, daytimeSignals, snapshotHistory] = await Promise.all([
    repo.getOuraDaily(userId, todayIso, todayIso),
    repo.getOuraDailyDerived(userId, todayIso, todayIso),
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.listSleepSessions(userId, from28dIso, todayIso),
    repo.getHrForWindow(userId, todayMid, now),
    repo.getUserById(userId),
    repo.getOuraDaytimeSignals(userId, todayMid, now),
    // Widened from today-only to the peak window: the same rows carry today's persisted anchor
    // AND the daily HR peaks the reserve is now resolved from.
    repo.getBodyBatteryHistory(userId, fromPeakWindowIso, todayIso),
  ])

  const ouraToday = ouraRows[0] ?? null
  const derivedToday = derivedRows[0] ?? null

  // ── Resting HR baseline + HRmax (for HR reserve) ──────────────────────────
  const rhrRows = bodyMetrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0)
  const restingHr = rhrRows.length
    ? Math.round(rhrRows.reduce((s, m) => s + m.restingHeartRate!, 0) / rhrRows.length)
    : 60
  const age = ageFromDob(user?.dateOfBirth, now)
  // The reserve is resolved from what this body has actually reached, not 220 − age. On the owner's
  // data the estimate reads 190 against a real 90-day peak of 168, and an inflated ceiling makes
  // every heart rate a smaller fraction of reserve — which is why drain almost never triggered.
  // See resolveBatteryHrMax for why this is NOT resolveMaxHr from observed-hr.ts.
  const hrMaxResolved = resolveBatteryHrMax(
    snapshotHistory.map(r => r.hrMaxObserved),
    hrMaxFromAge(age),
    restingHr,
  )
  const hrMax = hrMaxResolved.hrMax
  const reserve = hrReserve(hrMax, restingHr)

  // ── Wake anchor ───────────────────────────────────────────────────────────
  // The night that ended today, with naps excluded and fragments reassembled (findings F-1/Q-1).
  // Sorting the raw sessions by `sleepEnd` and taking the first — what this did — is the same bug
  // that made a nap override the night for the Sleep Score, and here it was worse: an evening nap
  // moved the wake anchor to the END of that nap, so the entire day's HR fell before `wakeTime` and
  // was discarded. On 2026-07-26 that produced a flat battery of 29 all day with
  // `hr_sample_count = 0`, while 164 ring samples sat unused after the real 05:54 wake (Q-17).
  const nights = nightSessions(sleepSessions, tz)
  const todaySleep = nights.findLast(n => n.date === todayIso)
  const firstHrTime = hrRows.length ? hrRows[0].timestamp.getTime() : null
  const rawWakeTime = todaySleep?.sleepEnd?.getTime()
    ?? firstHrTime
    ?? (todayMid.getTime() + 7 * 3_600_000)   // default 07:00
  // A wake time in the future (the route runs before the night's recorded end — the ring stamps a
  // wake later than the moment the app is opened) would leave the walk with no samples at all and
  // render a flat line that looks like a measurement. Fall back to the first reading of the day.
  const wakeTime = rawWakeTime > now.getTime() ? (firstHrTime ?? todayMid.getTime()) : rawWakeTime

  // Anchor precedence (S2 — data-efficiency review §3.2): our own persisted composite
  // readiness for today, then our own sleep score computed from last night's session, then
  // the frozen Cloud columns (null for every post-re-key day — legacy arms only), then 50.
  // The derived readiness row only exists once /api/readiness-score has run today, which is
  // exactly why the sleep-score fallback matters in the early morning.
  // Baselines from the prior nights only — same derivation the readiness route uses, so this
  // early-morning fallback anchor can't disagree with the score the Health screen shows later.
  const ownSleepScore = todaySleep
    ? computeSleepScore(todaySleep, tz, sleepScoreBaselines(
        nights.filter(s => s.sleepEnd.getTime() < todaySleep.sleepEnd.getTime()), tz,
      ))?.score ?? null
    : null
  // The precedence itself is unchanged; what changed is that a readiness anchor, once today has
  // one, is frozen for the rest of the day. Re-picking on every read shifted the whole curve the
  // moment /api/readiness-score first ran (Q-39). resolveAnchor owns the rule and clamps.
  // getBodyBatteryHistory returns date-ASCENDING, so with the window widened past today-only
  // this must select by date — [0] is now the oldest row in the window, not today's.
  const todaySnapshot = snapshotHistory.find(r => r.date === todayIso) ?? null
  // Q-42: readiness is the anchor we actually want, but it only exists once
  // /api/readiness-score has run today and persisted it — so the first Body Battery read of any
  // day used to fall back to the sleep score and paint a *provisional* anchor that later changed
  // under the user. Compute it here instead when it is missing.
  //
  // This is the expensive path (~11 repository reads) and it is entered deliberately: the builder
  // persists what it computes, so it runs at most once per day and every later read on either
  // route hits the stored row. Only taken when there is no persisted snapshot either — once the
  // day's anchor is frozen, resolveAnchor prefers it and readiness would not change the result.
  let derivedReadiness = derivedToday?.readinessScore ?? null
  // Only when readiness could plausibly compute at all — the builder needs some signal to form a
  // composite, and calling it for a user with nothing recorded would be pure cost on every read,
  // since it would never persist and so never stop being retried.
  const readinessPlausible = ouraToday != null || ownSleepScore != null || bodyMetrics.length > 0
  if (derivedReadiness == null && !todaySnapshot && readinessPlausible) {
    try {
      await buildReadinessPayload(userId, tz)
      // Deliberately re-read rather than using the returned `score`. The builder persists only when
      // it formed a real composite; with thin data it still returns a number, and treating that as
      // an anchor would replace an honest `default`/`sleep` with a confident-looking wrong one.
      // Re-reading takes exactly the signal the persisted path has always used — no new judgement.
      const [refreshed] = await repo.getOuraDailyDerived(userId, todayIso, todayIso)
      derivedReadiness = refreshed?.readinessScore ?? null
    } catch (err) {
      // Best-effort: a readiness failure must not take Body Battery down with it. Falling through
      // leaves the pre-Q-42 behaviour — the provisional sleep-score anchor.
      console.error('[body-battery] on-demand readiness failed (anchoring on sleep instead):', err)
    }
  }

  const { anchor, anchorSource, provisional: anchorProvisional } = resolveAnchor({
    persisted: todaySnapshot
      ? { anchor: todaySnapshot.anchor, anchorSource: todaySnapshot.anchorSource as AnchorSource }
      : null,
    derivedReadiness,
    ownSleepScore,
    cloud: ouraToday
      ? { readinessScore: ouraToday.readinessScore ?? null, sleepScore: ouraToday.sleepScore ?? null }
      : null,
  })

  // ── Daytime stress series (dHRV) → extra drain ────────────────────────────
  // hr_baseline = resting HR; dhrv_baseline = recent overnight-HRV mean (proxy at cold start);
  // temp_baseline = mean measured skin temp. The stress signal is each bucket's dHRV vs the day's
  // median (self-calibrating), so the overnight-vs-daytime baseline offset doesn't bias it. No
  // daytime signal → empty series → no modifier (battery behaves exactly as before).
  const hrvRows = bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0)
  const dhrvBaseline = hrvRows.length ? hrvRows.reduce((s, m) => s + m.hrvMs!, 0) / hrvRows.length : null
  const tempBaseline = daytimeSignals.temp.length
    ? daytimeSignals.temp.reduce((s, t) => s + t.valueC, 0) / daytimeSignals.temp.length
    : null
  // D5 — own daytime-HRV: a persisted-model lookup + closed-form eval, no ONNX inference and no
  // re-fitting on this live request path (the fit is precomputed, refit-throttled, from the
  // server-side raw-sample aggregation pass — see adapter.ts's maybeRefitDaytimeHrvModel).
  let stressSeries: StressPoint[] = []
  const dhrvModel = await repo.getDaytimeHrvModel(userId)
  if (dhrvModel && dhrvBaseline != null && tempBaseline != null && tempBaseline > 0) {
    const baselines: DhrvBaselines = { dhrvBaseline, hrBaseline: restingHr, tempBaseline }
    // TN-4. Two hardening changes, both "worth doing regardless of root cause" — the 31 × 500 on
    // 2026-08-23 (`daytime-stress: constants not set`, 10:37–20:59 UTC) stopped on its own and is
    // still unexplained.
    //
    // 1. Self-inject rather than assume boot got there. `ensureServerOuraConstants()` runs at boot
    //    from instrumentation-node.ts, and `lib/data/index.ts` calls the swallowing variant when the
    //    repository handle is built — but that one swallows, so it can fail to take without a trace,
    //    which is consistent with what happened. The injector is idempotent and documents this exact
    //    use ("a composition root that is unsure whether boot reached it should just call it");
    //    after the first call it is three boolean checks. The TRY variant deliberately: the throwing
    //    one would turn a missing constants directory back into the 500 this is removing.
    tryEnsureServerOuraConstants()
    try {
      stressSeries = buildDaytimeStressSeriesFromModel(
        daytimeSignals.temp, daytimeSignals.met,
        hrRows.map(r => ({ tsMs: r.timestamp.getTime(), bpm: r.bpm })),
        dhrvModel, baselines, wakeTime, now.getTime(),
      )
    } catch (err) {
      // 2. A stress-model failure must not take Body Battery down with it — the same guard, and the
      //    same reasoning, as the readiness call above. This throw was reaching the outer catch, so
      //    the WHOLE card 500'd when only the stress strip was unavailable. Falling through leaves
      //    `stressSeries` empty, which the walk already handles: `stressAt` returns null and the
      //    STRESS_DRAIN_RATE term is simply not applied.
      //    TN-7: report it as well as logging it. `console.error` reaches no table, so from TN-4's
      //    deploy onward a recurrence of `daytime-stress: constants not set` — the fault that fired
      //    31 times on 2026-08-23 — produced no row anywhere, and LA-20's open verification is
      //    waiting on exactly that count. A hardening change that turns a loud failure into a quiet
      //    degradation also removes the evidence a separate investigation was relying on; the card
      //    must still degrade, what changes is that the degradation leaves a trace.
      console.error('[body-battery] daytime stress series failed, continuing without it:', err)
      reportServerError(err, { userId, url: '/api/body-battery#stress' })
    }
  }
  // Step lookup: stressLevel (∈[−1,1]) of the most recent bucket at/under a time (30-min, held forward).
  const stressAt = (ms: number): number | null => {
    let v: number | null = null
    for (const p of stressSeries) { if (p.t <= ms) v = p.stressLevel; else break }
    return v
  }

  // ── Walk the HR series from wake → now ────────────────────────────────────
  // The arithmetic lives in `walkBodyBattery` (packages/shared/src/health/body-battery-walk.ts) so
  // it can be driven without a database — TN-2 needs the charge-window offset fitted against the
  // shipped TypeScript rather than a SQL replay, and that is impossible while the loop is welded
  // into this function. The constants stay declared HERE and are passed in, so this route remains
  // the one place they are chosen.
  const walk = walkBodyBattery(
    hrRows.map(r => ({ tsMs: r.timestamp.getTime(), bpm: r.bpm })),
    {
      anchor, wakeTime, restingHr, reserve,
      restThreshold: REST_THRESHOLD,
      chargeRate: CHARGE_RATE,
      drainRate: DRAIN_RATE,
      stressDrainRate: STRESS_DRAIN_RATE,
      gapHoldMin: GAP_HOLD_MIN,
      sampleCapMin: SAMPLE_CAP_MIN,
      stressAt,
    },
  )
  const battery = walk.battery
  const charged = walk.charged
  const drained = walk.drained
  const stressDrained = walk.stressDrained
  const series: BodyBatteryPoint[] = walk.series
  const wakingRowCount = walk.sampleCount

  const hasData = wakingRowCount > 0
  // Sparse days are unmeasured days, not calm ones — the ring power-gates its PPG when worn and
  // idle. Seven of 36 measured production days carried under 100 waking samples and the battery
  // travelled 8 points across the whole day, rendered as confidently as a 2,541-sample day.
  const confidence = batteryConfidence(wakingRowCount, (now.getTime() - wakeTime) / 60_000)
  // Carry the line to "now" so the chart ends at the present moment.
  if (series[series.length - 1].t < now.getTime()) {
    series.push({ t: now.getTime(), v: Math.round(battery) })
  }

  // ── Trend over the last ~20 minutes ───────────────────────────────────────
  const twentyAgo = now.getTime() - 20 * 60_000
  const past = [...series].reverse().find(p => p.t <= twentyAgo) ?? series[0]
  const diff = battery - past.v
  const trend: BodyBatteryResponse['trend'] =
    diff > 1 ? 'charging' : diff < -1 ? 'draining' : 'steady'

  const current = Math.round(battery)

  // ── Persist today's stress summary (completed-form, review S5) ─────────────
  // Same posture as the snapshot below and the readiness route's persist: writes ONLY the
  // three stress columns (COALESCE upsert — never touches source/model_versions or any
  // sibling metric's provenance on the row), and a failure never fails the read.
  const stressSummary = summarizeStressDay(stressSeries)

  // Both writes below are fire-and-forget: they are best-effort snapshots (COALESCE upserts that
  // touch only their own columns), so we never hold a pool connection or delay the read while they
  // run. Under the home/health load burst this route's response returning promptly is what keeps it
  // off the 499 path; the writes settle in the background (Railway is a long-lived Node server).
  // Both carry a .catch so an unawaited rejection can't surface as an unhandledRejection.
  // BF-81. This route still COMPUTES a stress summary for today's response — that is what the strip
  // and the number are drawn from on a live read — but it no longer PERSISTS one. Its series is
  // built from `restingHr` + a 28-day HRV mean; the rollup's from `latest.rhrLowBpm` + `nightHrvMs`.
  // Storing both put two numbers behind one metric, and they disagreed: measured in production over
  // the eight days that had both, the sign differed on **6** and high-stress minutes by 4–8×.
  // The rollup owns persistence because it is the only path that can re-derive history from the
  // packed raw tier, so a wide pass fills the past instead of starting from today.

  // Write-through daily snapshot (for model tuning — see docs/body-battery-tuning.md). Every read
  // updates today's row, so the last read of the day captures the end-of-day value.
  {
    const values = series.map(p => p.v)
    // Corroborated, not a bare Math.max: this column is persisted per day and was being
    // read as an all-time max-HR override, so a single motion artefact became a permanent
    // ceiling that pushed every derived target upward.
    const observedMax = computeObservedHr(hrRows.map(r => r.bpm)).max
    repo.upsertBodyBatteryDaily(userId, {
      date:          todayIso,
      anchor:        Math.round(anchor),
      anchorSource,
      endValue:      current,
      dayMin:        Math.min(...values),
      dayMax:        Math.max(...values),
      totalCharged:  Math.round(charged),
      totalDrained:  Math.round(drained),
      restingHr,
      hrMax,
      hrMaxObserved: observedMax,
      hrSampleCount: wakingRowCount,
      modelVersion:  MODEL_VERSION,
    }).catch(() => { /* snapshot is best-effort — never fail the read */ })
  }

  return NextResponse.json({
    current,
    label: labelFor(current),
    trend,
    anchor: Math.round(anchor),
    anchorSource,
    anchorProvisional,
    charged: Math.round(charged),
    drained: Math.round(drained),
    // The anchor the curve was actually walked from — re-deriving it here let the reported wake
    // time disagree with the one the series starts at.
    wakeTime,
    series,
    hasData,
    confidence,
    hrMax: {
      value: hrMax,
      source: hrMaxResolved.source,
      observedPeak: hrMaxResolved.observedPeak,
      peakDays: hrMaxResolved.peakDays,
    },
    stress: stressSeries.length
      ? {
          current: Math.round(stressSeries[stressSeries.length - 1].stressLevel * 100) / 100,
          draining: (stressAt(now.getTime()) ?? 0) < 0,
          extraDrained: Math.round(stressDrained * 10) / 10,
          series: stressSeries.map(p => ({ t: p.t, level: Math.round(p.stressLevel * 100) / 100 })),
          highMinutes: stressSummary?.stressHighMinutes ?? null,
        }
      : null,
  } satisfies BodyBatteryResponse, { headers: { "Cache-Control": "private, no-store" } })
}
