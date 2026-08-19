import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { computeBodyComposition, hasValidImpedance } from '@/lib/scale-ble/composition'
import { ageFromDob, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { applyScaleReadingToBodyMetrics } from '@/lib/scale-ble/apply-reading'
import { invalidUuidResponse } from '@/lib/api/route-errors'

// Confirms a pending scale reading (staged by the anomaly check because it looked like a big
// jump from the account's usual weight) — runs the same composition calc + body_metrics upsert
// the normal path would have run immediately, now that the account owner has confirmed it's them.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { id: idParam } = await params
  const badId = invalidUuidResponse(idParam)
  if (badId) return badId
  const id = Number(idParam)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const repo = await getRepositoryAsync()
  const row = await repo.confirmScaleSample(userId, id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const decoded = row.decoded as { weightKg?: number; impedanceOhmsA?: number; impedanceOhmsB?: number } | null
  if (typeof decoded?.weightKg !== 'number' || typeof decoded.impedanceOhmsA !== 'number' || typeof decoded.impedanceOhmsB !== 'number') {
    return NextResponse.json({ error: 'Reading missing decode data' }, { status: 500 })
  }

  const user = await repo.getUserById(userId)
  const tz = user?.timezone ?? DEFAULT_TZ
  const impedanceOhms = (decoded.impedanceOhmsA + decoded.impedanceOhmsB) / 2
  const heightCm = user?.heightCm ?? 170
  const ageYears = ageFromDob(user?.dateOfBirth, new Date()) ?? 35

  const impedanceValid = hasValidImpedance(impedanceOhms)
  const composition = impedanceValid
    ? computeBodyComposition({ weightKg: decoded.weightKg, impedanceOhms, heightCm, ageYears, sex: user?.sex })
    : null

  // Q-25: `row.measuredAt`, never today. A pending reading is confirmed whenever the owner next
  // opens the app — potentially days after the anomaly gate staged it — so keying this write on
  // today filed the weigh-in against the wrong day almost every time it was used.
  const { trendUpdated } = await applyScaleReadingToBodyMetrics(repo, userId, {
    measuredAt: row.measuredAt, tz, weightKg: decoded.weightKg, composition,
  })

  return NextResponse.json({
    status: 'confirmed', weightKg: decoded.weightKg,
    compositionSkipped: !impedanceValid,
    // See the note in /api/scale-ble/samples — the wire name is kept for the installed APK; the
    // meaning is "trend unchanged", which is what its toast copy actually says.
    isAdditionalReadingForDay: !trendUpdated,
  })
}
