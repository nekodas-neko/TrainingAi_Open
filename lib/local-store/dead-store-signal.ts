// K4: a tiny reactive signal for "the on-device local store failed to open".
// sync-provider flips it after initSQLite throws; the LocalStoreDeadBanner
// subscribes via useSyncExternalStore. Kept out of any React module so both the
// provider and the banner can import it without a cycle.
let _dead = false;
const listeners = new Set<() => void>();

export function markLocalStoreDead(): void {
  if (_dead) return;
  _dead = true;
  for (const l of listeners) l();
}

export function isLocalStoreDeadSignal(): boolean {
  return _dead;
}

export function subscribeLocalStoreDead(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
