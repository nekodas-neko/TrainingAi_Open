/**
 * The phone's "Remove animations" setting, read once and shared (#3758). It used to be read by
 * every component that mounted and assumed "reduced" until the phone answered, so the first motion
 * of a newly shown piece was skipped. The store asks once, when the app starts; until the answer
 * arrives (a few milliseconds) motion counts as allowed.
 */
export type ReducedMotionSource = {
  read: () => Promise<boolean>;
  /** Calls `onChange` when the setting changes; returns the way to stop. */
  watch: (onChange: (reduced: boolean) => void) => () => void;
};

export function createReducedMotionStore(source: ReducedMotionSource) {
  let reduced = false;
  const listeners = new Set<() => void>();
  function set(value: boolean) {
    if (value === reduced) return;
    reduced = value;
    listeners.forEach((listener) => listener());
  }
  source.watch(set);
  void source.read().then(set, () => undefined);
  return {
    get: () => reduced,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
