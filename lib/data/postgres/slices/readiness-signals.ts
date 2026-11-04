// #3610: the readiness inputs a connector calculates for itself, in the generic shapes readiness reads
// (`@trainingai/shared/health/readiness-signals`). Each connector that supplies one registers its
// reader here by its id, mapping its own fields; scoring never sees a source's field names.
import type { getDb } from '../client'
import type { OvernightRecoveryHours, RecoveryContributor } from '@trainingai/shared/health/readiness-signals'
import { DATA_SOURCE_CONNECTORS } from '@trainingai/shared/health/source-connectors'
import { ouraOvernightRecoveryHours, ouraRecoveryContributors } from '@/lib/oura/cloud/readiness-signals-map'
import { getOuraCloudReadinessContributors, getOuraCloudRecoveryIndexHours } from './oura'

type Db = ReturnType<typeof getDb>

interface ReadinessSignalReaders {
  recoveryContributors?: (db: Db, userId: string, from: string, to: string) => Promise<RecoveryContributor[]>
  overnightRecoveryHours?: (db: Db, userId: string, dates: string[], tz: string) => Promise<OvernightRecoveryHours[]>
}

const READERS: Readonly<Record<string, ReadinessSignalReaders>> = {
  oura_cloud: {
    recoveryContributors: async (db, userId, from, to) => ouraRecoveryContributors(await getOuraCloudReadinessContributors(db, userId, from, to)),
    overnightRecoveryHours: async (db, userId, dates, tz) => ouraOvernightRecoveryHours(await getOuraCloudRecoveryIndexHours(db, userId, dates, tz)),
  },
}

/** Every connector's readers, in registry order. A connector that supplies neither has no entry. */
const readersInOrder = () => DATA_SOURCE_CONNECTORS.map(c => READERS[c.id]).filter((r): r is ReadinessSignalReaders => r != null)

export async function recoveryContributors(db: Db, userId: string, from: string, to: string): Promise<RecoveryContributor[]> {
  const out: RecoveryContributor[] = []
  for (const r of readersInOrder()) if (r.recoveryContributors) out.push(...await r.recoveryContributors(db, userId, from, to))
  return out
}

export async function overnightRecoveryHours(db: Db, userId: string, dates: string[], tz: string): Promise<OvernightRecoveryHours[]> {
  const out: OvernightRecoveryHours[] = []
  for (const r of readersInOrder()) if (r.overnightRecoveryHours) out.push(...await r.overnightRecoveryHours(db, userId, dates, tz))
  return out
}
