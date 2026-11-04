// #3597: the per-minute movement series every connector declaring `perMinuteMovement` supplies, in the
// generic shape scoring reads (`MovementIntervalSeries`). Each connector's own reader and mapping is
// registered here by its id; a connector that declares the capability without a reader fails loudly
// rather than reading as "no movement".
import type { getDb } from '../client'
import type { MovementIntervalSeries } from '@trainingai/shared/health/per-minute-movement'
import { DATA_SOURCE_CONNECTORS } from '@trainingai/shared/health/source-connectors'
import { ouraActivityMovementSeries } from '@/lib/oura/cloud/activity-movement'
import { getOuraCloudActivitySeries } from './oura'

type Db = ReturnType<typeof getDb>
type MovementReader = (db: Db, userId: string, from: string, to: string) => Promise<MovementIntervalSeries[]>

const READERS: Readonly<Record<string, MovementReader>> = {
  oura_cloud: async (db, userId, from, to) => ouraActivityMovementSeries(await getOuraCloudActivitySeries(db, userId, from, to)),
}

export async function perMinuteMovementSeries(db: Db, userId: string, from: string, to: string): Promise<MovementIntervalSeries[]> {
  const sources = DATA_SOURCE_CONNECTORS.filter(c => c.capabilities.perMinuteMovement)
  const out: MovementIntervalSeries[] = []
  for (const c of sources) {
    const read = READERS[c.id]
    if (!read) throw new Error(`[movement-series] ${c.id} declares perMinuteMovement but has no reader`)
    out.push(...await read(db, userId, from, to))
  }
  return out
}
