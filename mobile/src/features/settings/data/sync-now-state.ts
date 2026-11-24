import { syncNowRunner } from '../../../core/sync/deadline.ts';

/**
 * One Sync now for the whole app (#3906 review): Data & Sync, Sign out and Delete account each
 * used to build their own runner, so each could start its own run at once. Now a run started on
 * one screen is the run the others join, and every screen shows the same busy flag and result.
 */
export type SyncNowView = { busy: boolean; error: string | null; message: string | null };
/**
 * `setAccount(key)` is called whenever the signed-in account changes (the same `dataReader`
 * connection the stores reopen on): the text, busy flag and followed run of the account before it
 * are dropped, and the run it left behind can no longer write to the view or be joined.
 */
export function createSyncNowShared() {
  let state: SyncNowView = { busy: false, error: null, message: null };
  let account: string | null = null;
  let epoch = 0;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SyncNowView>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const build = (mine: number) =>
    syncNowRunner({
      setBusy: (busy) => mine === epoch && set({ busy }),
      setError: (error) => mine === epoch && set({ error }),
      setMessage: (message) => mine === epoch && set({ message }),
    });
  let runner = build(epoch);
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setAccount: (key: string | null) => {
      if (key === account) return;
      account = key;
      epoch++;
      runner.dispose();
      runner = build(epoch);
      set({ busy: false, error: null, message: null });
    },
    run: (start: Parameters<typeof runner>[0]) => runner(start),
  };
}
export const syncNowShared = createSyncNowShared();
