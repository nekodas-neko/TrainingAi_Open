// Freshness gate for the Oura Cloud sync now that the direct-BLE pipeline is the live
// biometric source (Chunk 4, 2026-07-07 data-mapping plan). "Fresh" means BLE has produced
// data recently enough that firing the frozen Cloud sync would be pointless — Cloud data
// stopped advancing at the 2026-07-07 re-key.
export const BLE_FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h

export function isBleDataFresh(lastMeasuredAtIso: string | null, nowMs: number): boolean {
  if (!lastMeasuredAtIso) return false;
  const measuredMs = new Date(lastMeasuredAtIso).getTime();
  if (!Number.isFinite(measuredMs)) return false;
  return nowMs - measuredMs < BLE_FRESHNESS_WINDOW_MS;
}
