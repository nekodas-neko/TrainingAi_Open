/**
 * Which stores' set-aside notice the Home header is actually showing. A store's notice is on screen
 * only while it is also that store's current error: a later transient failure overwrites the error
 * and hides the notice, and an unseen notice must not be acknowledged then.
 */
export function setAsideShown(
  show: boolean,
  home: { setAside: string | null; error: string | null },
  health: { setAside: string | null; error: string | null },
): { home: boolean; health: boolean } {
  return {
    home: show && !!home.setAside && home.error === home.setAside,
    health: show && !!health.setAside && health.error === health.setAside,
  };
}
