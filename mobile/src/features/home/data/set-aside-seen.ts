/**
 * Which stores' set-aside notice the Home header is actually showing. The header lists every store's
 * `setAside` beside its live errors, so a notice is on screen whenever the header is (`show`) and the
 * store holds one; a transient failure no longer hides it. Only the store that showed one is
 * acknowledged.
 */
export function setAsideShown(
  show: boolean,
  home: { setAside: string | null },
  health: { setAside: string | null },
): { home: boolean; health: boolean } {
  return {
    home: show && !!home.setAside,
    health: show && !!health.setAside,
  };
}

/**
 * The messages the Home header lists for the two stores: each one's live failures, then its set-aside
 * notice. `setAsideShown` counts a notice as seen only because this includes it.
 */
export function storeHeaderMessages(
  home: { error: string | null; setAside: string | null; errors: Record<string, string | null | undefined> },
  health: { error: string | null; setAside: string | null },
): (string | null | undefined)[] {
  return [home.error, home.setAside, ...Object.values(home.errors), health.error, health.setAside];
}
