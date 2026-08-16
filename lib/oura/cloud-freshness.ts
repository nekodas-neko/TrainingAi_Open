// The Oura Ring 5 was re-keyed onto our own BLE auth key on 2026-07-07 — since then
// the Oura Cloud gets no new data from this ring, EVER (CLAUDE.md, Oura Direct-BLE).
// Any oura_daily Cloud-sourced value dated on/before this day is a frozen snapshot,
// not a current reading. This is the single re-key constant in the codebase — every
// staleness gate imports it from here (One Formula, One Place).
export const OURA_CLOUD_REKEY_DATE = '2026-07-07'

/** True when a YYYY-MM-DD day is on/before the re-key (frozen Cloud era).
 *  No date → cannot prove freshness → treat as stale (fail closed). */
export function isPreRekey(dateStr: string | null | undefined): boolean {
  if (!dateStr) return true
  return dateStr <= OURA_CLOUD_REKEY_DATE
}
