/**
 * Runs the on-device read BESIDE the network request instead of before it (issue 2831).
 *
 * The workout screen used to await `getActiveProgramLocal()` before it asked the server for
 * anything, so a slow native SQLite held the network back and the skeleton stayed up. Whichever
 * answer lands first paints; once the network has landed, a late local answer is dropped so it can
 * never put the program's base numbers back over the server's prescribed ones.
 *
 * `read` rejecting is a miss, never an error: the network response is the authority.
 */
export function startLocalSeed<L>(read: () => Promise<L | null>, paint: (local: L) => void) {
  let networkLanded = false;
  const settled = read()
    .then(local => { if (!networkLanded && local) paint(local); })
    .catch(() => {});
  return {
    /** Resolves once the local read has finished and, if it was still wanted, painted. */
    settled,
    /** Call as the network response arrives. */
    networkLanded: () => { networkLanded = true; },
  };
}
