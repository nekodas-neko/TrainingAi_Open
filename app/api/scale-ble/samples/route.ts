import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'
import { computeBodyComposition, hasValidImpedance, SCALE_WEIGHT_ANOMALY_PCT } from '@/lib/scale-ble/composition'
import { ageFromDob, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { applyScaleReadingToBodyMetrics } from '@/lib/scale-ble/apply-reading'
import { resolveMeasuredAt } from '@trainingai/shared/validation/ingest-clock'
import { reportServerError } from '@/lib/observability'

// Direct-BLE scale ingest — the native foreground service (ScaleBleService.kt) POSTs a single
// decoded weigh-in here using the shared session cookie (CookieManager), same mechanism as
// /api/hr-ingest for the Polar chest strap. That's what attributes a reading to the right user:
// whichever account's session is live on the phone that captured it.
//
// Multi-user safety net: the owner's partner also uses this physical scale. A reading that
// differs from the user's last confirmed weight by more than SCALE_WEIGHT_ANOMALY_PCT is staged
// as 'pending' instead of auto-saved — see docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md
// "Multi-user safety net" section.
const MAX_BODY_BYTES = 4 * 1024

// Q-24 §7: `weightKg` was floored at 0. A no-load or mid-stabilisation frame decodes as 0 kg, and
// with no prior confirmed weight to compare against, the anomaly gate below computes deltaPct = 0
// and waves it straight through to body_metrics. This floor is below any adult who would step on
// this scale while still being far above a decode fault.
const MIN_SCALE_WEIGHT_KG = 20

const BodySchema = z.object({
  weightKg: z.number().min(MIN_SCALE_WEIGHT_KG).max(500),
  impedanceOhmsA: z.number().min(0).max(5000),
  impedanceOhmsB: z.number().min(0).max(5000),
  rawHex: z.string().regex(/^[0-9a-fA-F]*$/).max(256),
  measuredAt: z.string().datetime().optional(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`scale-ble-ingest:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })
  const result = BodySchema.safeParse(parsed.body)
  if (!result.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { weightKg, impedanceOhmsA, impedanceOhmsB, rawHex, measuredAt } = result.data
  const measuredAtDate = resolveMeasuredAt(measuredAt)

  try {
    const repo = await getRepositoryAsync()
    const user = await repo.getUserById(userId)
    const tz = user?.timezone ?? DEFAULT_TZ

    const lastWeightKg = await repo.getMostRecentConfirmedWeightKg(userId)
    const deltaPct = lastWeightKg ? Math.abs(weightKg - lastWeightKg) / lastWeightKg : 0
    const isAnomalous = lastWeightKg != null && deltaPct > SCALE_WEIGHT_ANOMALY_PCT

    if (isAnomalous) {
      await repo.insertScaleRawSample(userId, {
        measuredAt: measuredAtDate, rawHex,
        decoded: { weightKg, impedanceOhmsA, impedanceOhmsB },
        status: 'pending',
      })
      return NextResponse.json({
        status: 'pending', weightKg, lastWeightKg,
        deltaPct: Math.round(deltaPct * 1000) / 1000,
      })
    }

    const impedanceOhms = (impedanceOhmsA + impedanceOhmsB) / 2
    const heightCm = user?.heightCm ?? 170
    const ageYears = ageFromDob(user?.dateOfBirth, new Date()) ?? 35

    // Socks, stockings, or dry feet break the foot-plate contact BIA needs — the scale reports
    // impedance as 0 rather than omitting the reading, which would otherwise divide-by-zero the
    // composition formula into a floored, meaningless body-fat% (see MIN_VALID_IMPEDANCE_OHMS).
    // The weight itself is a load-cell reading, unaffected by contact quality, so it still saves.
    const impedanceValid = hasValidImpedance(impedanceOhms)
    const composition = impedanceValid
      ? computeBodyComposition({ weightKg, impedanceOhms, heightCm, ageYears, sex: user?.sex })
      : null

    await repo.insertScaleRawSample(userId, {
      measuredAt: measuredAtDate, rawHex,
      decoded: { weightKg, impedanceOhmsA, impedanceOhmsB, impedanceValid, ...(composition ?? {}) },
      status: 'confirmed',
    })

    // `measuredAt` is already clamped to a sane window above, so it is safe to key the day off.
    const { trendUpdated } = await applyScaleReadingToBodyMetrics(repo, userId, {
      measuredAt: measuredAtDate, tz, weightKg, composition,
    })

    return NextResponse.json({
      status: 'confirmed', weightKg,
      compositionSkipped: !impedanceValid,
      // Deliberately the inverse of `trendUpdated`, and deliberately NOT renamed: the installed
      // APK reads this field name and renders "Additional reading today" from it, which is really
      // saying "this did not change your trend". Since a lower second reading now DOES become the
      // trend, that copy is only correct if the flag means "trend unchanged" — so the meaning moves
      // and the wire name stays, and no new APK is needed for the toast to stay honest.
      isAdditionalReadingForDay: !trendUpdated,
    })
  } catch (err) {
    console.error('[scale-ble/samples]', String(err).slice(0, 200))
    reportServerError(err, { userId, url: '/api/scale-ble/samples' })
    return NextResponse.json({ error: 'Write failed' }, { status: 500 })
  }
}
