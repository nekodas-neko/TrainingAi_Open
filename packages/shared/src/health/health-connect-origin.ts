/**
 * Health Connect records that are a second copy of data we already read first-hand (#3115 part 2).
 *
 * The Oura app can write sleep, heart rate, HRV, steps, SpO₂, temperature and workouts to Health
 * Connect. While the user has Oura Cloud connected, the server gets the same data straight from
 * Oura's API, so the phone's copy adds nothing but a chance to double-count it (per-day means pool
 * every app, and nights from two sources used to be summed). Both phone readers drop it before
 * upload: the current app's `lib/health-connect-sync.ts` and Preview's `HealthConnectImportStore`.
 *
 * The rule is by origin, not by record type: whatever Oura writes is something Oura Cloud serves.
 * A record from any other app, or with no origin, is always kept. Without the connection (or when
 * the phone does not know yet) nothing is dropped, so the server's source ladder (`settleNights`,
 * `source-rank.ts`) stays the safety net.
 *
 * Oura only for now. Renpho's and Polar's packages join once read from a device, never from memory.
 * The id is the one `mobile/src/features/devices/data/oura.ts` hands off to, and the one read from
 * the owner's phone on 20 Oct (#3115).
 */
export const OURA_APP_PACKAGE = 'com.ouraring.oura'

/**
 * What the phone knows about first-hand sources: `connectedSources` from `/api/readiness-score`.
 *
 * `ouraCloudTypes` (#3204) says, per Health Connect record type, whether Oura Cloud is delivering that
 * type to the server: the grant is alive and covers it. A server from before #3204 sends only
 * `ouraCloud`, and the server since sends both, `ouraCloud` true only while every type is delivered,
 * so an APK that reads only the boolean stays on the safe side.
 */
export interface FirstHandSources {
  ouraCloud?: boolean
  ouraCloudTypes?: Readonly<Record<string, boolean>>
}

/**
 * True when a record from `origin` (its `metadata.dataOrigin`) is a copy we already read first-hand.
 * With a record `type` and a per-type answer, only a type Oura Cloud delivers counts, and a type the
 * answer does not list does not; otherwise the one boolean decides.
 */
export function isFirstHandCopy(origin: unknown, sources: FirstHandSources | null | undefined, type?: string): boolean {
  if (origin !== OURA_APP_PACKAGE || !sources) return false
  if (type !== undefined && sources.ouraCloudTypes) return sources.ouraCloudTypes[type] === true
  return sources.ouraCloud === true
}

/** `records` without first-hand copies, and how many were dropped. */
export function dropFirstHandCopies<T>(
  records: readonly T[],
  originOf: (record: T) => unknown,
  sources: FirstHandSources | null | undefined,
): { kept: T[]; skipped: number } {
  if (sources?.ouraCloud !== true) return { kept: [...records], skipped: 0 }
  const kept = records.filter(r => !isFirstHandCopy(originOf(r), sources))
  return { kept, skipped: records.length - kept.length }
}

/**
 * The one cold-start rule, for both phones (#3197): the connection counts as known only when it came
 * from today's readiness payload. Anything else (nothing cached, the payload cleared by
 * `invalidateCache('readiness-score')`, yesterday's, a first offline run on a new day) is unknown, and
 * unknown keeps Oura's copies. Keeping is the safe side: the server ranks `oura_cloud` above Health
 * Connect (#3154), so a kept copy is outranked, while a wrongly skipped one is data nothing else sends.
 *
 * `payloadDate` is the local day the payload was fetched for; Preview loads the payload by today's
 * date, so it passes `today`.
 */
export function knownFirstHandSources(
  connectedSources: unknown,
  payloadDate: unknown,
  today: string,
): FirstHandSources | null {
  if (payloadDate !== today) return null
  if (!connectedSources || typeof connectedSources !== 'object') return null
  const { ouraCloud, ouraCloudTypes } = connectedSources as { ouraCloud?: unknown; ouraCloudTypes?: unknown }
  if (typeof ouraCloud !== 'boolean') return null
  // A per-type answer that is not a plain map of booleans is ignored, never half-read: the boolean,
  // which is true only while every type is delivered, then decides alone.
  const perType = ouraCloudTypes && typeof ouraCloudTypes === 'object' && !Array.isArray(ouraCloudTypes) &&
    Object.values(ouraCloudTypes).every(v => typeof v === 'boolean')
    ? { ...(ouraCloudTypes as Record<string, boolean>) }
    : undefined
  return perType ? { ouraCloud, ouraCloudTypes: perType } : { ouraCloud }
}

/**
 * The single gate every Health Connect read goes through, so a read type added later cannot upload
 * a first-hand copy by forgetting to filter (#3197). Counts what it drops per type, and a record seen
 * twice in one pass (a window's heart rate read again for a workout, a rescan page) counts once.
 * Make one per sync: its counts are that sync's, not a running total.
 */
export class FirstHandFilter<T> {
  private readonly dropped = new Map<string, Set<unknown>>()
  private unnamed = 0

  constructor(
    private readonly sources: FirstHandSources | null | undefined,
    private readonly originOf: (record: T) => unknown,
    private readonly idOf: (record: T) => string | undefined = () => undefined,
  ) {}

  /** False when `record` is a first-hand copy: left out, and counted under `type`. */
  admit(type: string, record: T): boolean {
    if (!isFirstHandCopy(this.originOf(record), this.sources, type)) return true
    let ids = this.dropped.get(type)
    if (!ids) this.dropped.set(type, (ids = new Set()))
    ids.add(this.idOf(record) ?? `#${this.unnamed++}`)
    return false
  }

  keep(type: string, records: readonly T[]): T[] {
    return records.filter(r => this.admit(type, r))
  }

  /** Records left out so far in this pass, per type; empty when none. */
  counts(): Record<string, number> {
    return Object.fromEntries([...this.dropped].map(([type, ids]) => [type, ids.size]))
  }
}
