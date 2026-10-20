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

/** What the phone knows about first-hand sources: `connectedSources` from `/api/readiness-score`. */
export interface FirstHandSources {
  ouraCloud?: boolean
}

/** True when a record from `origin` (its `metadata.dataOrigin`) is a copy we already read first-hand. */
export function isFirstHandCopy(origin: unknown, sources: FirstHandSources | null | undefined): boolean {
  return sources?.ouraCloud === true && origin === OURA_APP_PACKAGE
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
