// Test seam for fire-and-forget observability writes. Production never calls `flushPendingWrites`;
// callers of `reportServerError` and the retention prunes still get `void` back immediately, and a
// tracked promise never rejects here (each is caught at its own site before it is tracked).
// Kept dependency-free so the data layer can import it without a cycle.
const pending = new Set<Promise<unknown>>()

export function trackPendingWrite<T>(p: Promise<T>): Promise<T> {
  pending.add(p)
  const drop = () => { pending.delete(p) }
  p.then(drop, drop)
  return p
}

/** Resolves once every write tracked so far — and any a tracked write starts — has settled. */
export async function flushPendingWrites(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending])
  }
}
