import type { HomeWidgets } from './types';

export type GuardedHomeWidgets = HomeWidgets & {
  /** Lets writes through again; the sync mounted for a newly signed-in account calls it. */
  resume(): void;
};

/**
 * Refuses writes from the moment clearSnapshot() runs until resume(). Sign-out clears the snapshot
 * at once, but the old account's sync only unmounts at the next React commit, and its debounce can
 * fire in that gap and put the signed-out account's numbers back (#3279). The queued taps are the
 * old account's too, so they read as empty until an account's sync is mounted again.
 */
export function guardHomeWidgets(native: HomeWidgets): GuardedHomeWidgets {
  let cleared = false;
  return {
    writeSnapshot(json) {
      if (!cleared) native.writeSnapshot(json);
    },
    clearSnapshot() {
      cleared = true;
      native.clearSnapshot();
    },
    peekPending: () => (cleared ? '[]' : native.peekPending()),
    ackPending: (ids) => native.ackPending(ids),
    takeLaunchTarget: () => native.takeLaunchTarget(),
    resume() {
      cleared = false;
    },
  };
}
