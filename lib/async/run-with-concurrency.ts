// Run an array of async thunks with at most `limit` in flight at once, returning results in input
// order with Promise.allSettled semantics (a throwing thunk yields a 'rejected' entry and never
// rejects the whole batch). Used to bound the Home/Health aggregate-fetch burst so the ~13-wide
// fan-out — each endpoint of which itself fans out 6–7 DB queries — can't demand more than the
// server's 10-connection pool at once (the read-side thundering herd behind the 499s / "Sync failed").
export async function runWithConcurrency(
  thunks: ReadonlyArray<() => Promise<unknown>>,
  limit: number,
): Promise<PromiseSettledResult<unknown>[]> {
  const results = new Array<PromiseSettledResult<unknown>>(thunks.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < thunks.length) {
      const i = next++
      try {
        results[i] = { status: 'fulfilled', value: await thunks[i]() }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  const count = Math.max(1, Math.min(limit, thunks.length))
  await Promise.all(Array.from({ length: count }, () => worker()))
  return results
}
