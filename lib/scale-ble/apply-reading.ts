import type { WorkoutRepository } from '@/lib/data/repository'
import { toAestDay } from '@trainingai/shared/date-utils'
import type { ScaleComposition } from './composition'

/**
 * Writes a confirmed weigh-in to `body_metrics`.
 *
 * Two routes reach this: the direct ingest (`/api/scale-ble/samples`) and the confirm of a reading
 * the anomaly gate staged as pending (`/api/scale-ble/pending/[id]/confirm`). They carried
 * byte-identical copies of this block and had both drifted the same way (Q-25), so it lives here
 * once — the pattern this project keeps paying for.
 *
 * **Keyed on the reading's own local day, never on today.** Both copies used `todayInTz`, so a
 * weigh-in captured before midnight and pushed after it landed on the wrong day. On the confirm
 * path that was near-guaranteed rather than occasional: a pending reading is confirmed whenever the
 * owner next opens the app, which can be days after it was staged.
 *
 * **The day's LOWEST confirmed reading sets the trend** (Q-69, owner request). It used to be the
 * first, on the fasted-morning-weigh-in convention — but a first reading taken with clothes on was
 * then stuck as the day's value with no correction path short of a manual edit. Clothes only ever
 * add weight, so a later nude reading naturally comes in lower and should replace it. On an
 * ordinary day the fasted morning weigh-in is already the day's low point (food and water only add
 * weight afterwards), so this changes nothing for the common case — it fires only for the failure
 * mode it was designed for.
 *
 * Averaging same-day readings was considered and rejected: it launders a clothed reading into the
 * trend instead of replacing it, and blending readings taken at different food/water states makes
 * the trend noisier rather than more accurate.
 *
 * Returns `trendUpdated` rather than the old "was there already a reading today". The two used to
 * be the same question; they are not any more, because a lower second reading now both follows an
 * existing one AND becomes the trend. The caller needs to know which actually happened — see the
 * note on `isAdditionalReadingForDay` in `app/api/scale-ble/samples/route.ts`.
 *
 * Later readings still archive to `scale_raw_samples` unconditionally either way — nothing is lost
 * when a reading loses this comparison. A `manual` weight for the day is untouched by any of this:
 * the query behind the comparison filters on `source_map->>'weight_kg' = 'scale_ble'`, so a manual
 * entry reads as "no scale trend" and the rank merge (`lib/data/health-source.ts` mergeSet,
 * manual(5) > scale_ble(4)) keeps owning it.
 */
export async function applyScaleReadingToBodyMetrics(
  repo: WorkoutRepository,
  userId: string,
  args: {
    measuredAt: Date
    tz: string
    weightKg: number
    composition: ScaleComposition | null
  },
): Promise<{ readingDay: string; trendUpdated: boolean }> {
  const { measuredAt, tz, weightKg, composition } = args
  const readingDay = toAestDay(measuredAt, tz)
  const existing = await repo.getConfirmedScaleTrendForDate(userId, readingDay)
  // Strictly lower: an equal reading is a no-op (matching the previous de-dup intent) and a higher
  // one is discarded exactly as before.
  if (existing !== null && weightKg >= existing.weightKg) {
    return { readingDay, trendUpdated: false }
  }

  await repo.upsertBodyMetrics(userId, [{
    date: readingDay,
    weightKg,
    bodyFatPct: composition?.bodyFatPct,
    skeletalMusclePct: composition?.skeletalMusclePct,
    fatFreeMassKg: composition?.fatFreeMassKg,
    subcutaneousFatPct: composition?.subcutaneousFatPct,
    visceralFatIndex: composition?.visceralFatIndex,
    bodyWaterPct: composition?.bodyWaterPct,
    muscleMassKg: composition?.muscleMassKg,
    boneMassKg: composition?.boneMassKg,
    proteinPct: composition?.proteinPct,
    bmrKcal: composition?.bmrKcal,
    metabolicAge: composition?.metabolicAge,
  }], 'scale_ble')

  return { readingDay, trendUpdated: true }
}
