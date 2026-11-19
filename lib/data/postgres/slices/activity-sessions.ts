// #3875: the activity sessions every connector supplies, in the generic shape readers take
// (`SourceActivitySession`, connector guide §3d). Each connector's reader and mapping is registered
// here by its id, as the per-minute movement series are (`movement-series.ts`).
import type { getDb } from '../client'
import type { SourceActivitySession } from '@trainingai/shared/health/activity-sessions'
import { DATA_SOURCE_CONNECTORS } from '@trainingai/shared/health/source-connectors'
import { ouraActivitySessions } from '@/lib/oura/cloud/activity-sessions-map'
import { getOuraWorkouts } from './oura'

type Db = ReturnType<typeof getDb>
type SessionReader = (db: Db, userId: string, range: { from: string; to: string }) => Promise<SourceActivitySession[]>

/** Each reader returns its sessions newest day first; tombstoned ones are left out. */
const READERS: Readonly<Record<string, SessionReader>> = {
  oura_cloud: async (db, userId, range) => ouraActivitySessions(await getOuraWorkouts(db, userId, range)),
}

/** Every connector's sessions filed under a day in `[from, to]`, newest day first. */
export async function sourceActivitySessions(db: Db, userId: string, range: { from: string; to: string }): Promise<SourceActivitySession[]> {
  const out: SourceActivitySession[] = []
  for (const c of DATA_SOURCE_CONNECTORS) {
    const read = READERS[c.id]
    if (read) out.push(...await read(db, userId, range))
  }
  // Stable, so one source keeps its own order.
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
}
