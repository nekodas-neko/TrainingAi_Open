// #2377 — the shadow readiness model's per-day rows (`shadow_readiness`, migration 202610071507).
//
// Server-only: the scorer runs on the server beside the live readiness and nothing on the device
// reads the result, so there is no local-store domain and no outbox
// (docs/rules/offline-first-and-storage.md). Read through `claude_ro.shadow_readiness`.
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import type { ShadowReadinessRecord, ShadowReadinessStage } from '@trainingai/shared/types'

type Db = ReturnType<typeof getDb>

/**
 * Upsert on `(user_id, date, model_version)`. The conflict target leads with user_id, so the row it
 * replaces is already the caller's. Only a recompute of the SAME version replaces a row; another
 * version's row for the day is never touched, which is what keeps old shadow evidence.
 */
export async function upsertShadowReadiness(db: Db, userId: string, r: ShadowReadinessRecord): Promise<void> {
  const t = s.shadowReadiness
  await db.insert(t)
    .values({
      userId,
      date: r.date,
      modelVersion: r.modelVersion,
      shadowReadiness: r.shadowReadiness,
      sleepPillar: r.pillars.sleep,
      heartPillar: r.pillars.heart,
      activityPillar: r.pillars.activity,
      bodyPillar: r.pillars.body,
      pillarDetail: r.pillarDetail,
      units: r.units,
      maturityStage: r.maturityStage,
      inputsThrough: r.inputsThrough,
      liveReadiness: r.liveReadiness,
      liveModelVersion: r.liveModelVersion,
      computedBy: r.computedBy,
    })
    .onConflictDoUpdate({
      target: [t.userId, t.date, t.modelVersion],
      set: {
        shadowReadiness: sql`excluded.shadow_readiness`,
        sleepPillar: sql`excluded.sleep_pillar`,
        heartPillar: sql`excluded.heart_pillar`,
        activityPillar: sql`excluded.activity_pillar`,
        bodyPillar: sql`excluded.body_pillar`,
        pillarDetail: sql`excluded.pillar_detail`,
        units: sql`excluded.units`,
        maturityStage: sql`excluded.maturity_stage`,
        inputsThrough: sql`excluded.inputs_through`,
        liveReadiness: sql`excluded.live_readiness`,
        liveModelVersion: sql`excluded.live_model_version`,
        computedBy: sql`excluded.computed_by`,
        computedAt: sql`now()`,
      },
    })
}

export async function getShadowReadiness(
  db: Db, userId: string, from: string, to: string, modelVersion?: number,
): Promise<Array<ShadowReadinessRecord & { computedAt: Date }>> {
  const t = s.shadowReadiness
  const rows = await db.select().from(t)
    .where(and(
      eq(t.userId, userId),
      gte(t.date, from),
      lte(t.date, to),
      modelVersion === undefined ? undefined : eq(t.modelVersion, modelVersion),
    ))
    .orderBy(asc(t.date), asc(t.modelVersion))
  return rows.map(r => ({
    date: r.date,
    modelVersion: r.modelVersion,
    shadowReadiness: r.shadowReadiness,
    pillars: { sleep: r.sleepPillar, heart: r.heartPillar, activity: r.activityPillar, body: r.bodyPillar },
    pillarDetail: r.pillarDetail as Record<string, unknown>,
    units: r.units as Record<string, unknown>,
    maturityStage: r.maturityStage as ShadowReadinessStage,
    inputsThrough: r.inputsThrough,
    liveReadiness: r.liveReadiness,
    liveModelVersion: r.liveModelVersion,
    computedBy: r.computedBy as ShadowReadinessRecord['computedBy'],
    computedAt: r.computedAt,
  }))
}
