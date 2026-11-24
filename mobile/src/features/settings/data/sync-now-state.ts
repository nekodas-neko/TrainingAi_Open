import { syncNowRunner } from '../../../core/sync/deadline.ts';

/**
 * One Sync now for the whole app (#3906 review): Data & Sync, Sign out and Delete account each
 * used to build their own runner, so each could start its own run at once. Now a run started on
 * one screen is the run the others join, and every screen shows the same busy flag and result.
 */
export type SyncNowView = { busy: boolean; error: string | null; message: string | null };
export function createSyncNowShared() {
  let state: SyncNowView = { busy: false, error: null, message: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SyncNowView>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run: syncNowRunner({
      setBusy: (busy) => set({ busy }),
      setError: (error) => set({ error }),
      setMessage: (message) => set({ message }),
    }),
  };
}
export const syncNowShared = createSyncNowShared();
