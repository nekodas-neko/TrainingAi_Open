// A `react-native` and `react` stand-in for `core/sync/resume.ts`: an AppState a test can move
// between foreground and background, and a `useEffect` that runs at once and keeps its cleanup.
type Listener = (state: string) => void;
const listeners = new Set<Listener>();
export const AppState = {
  currentState: 'active',
  addEventListener(_type: 'change', listener: Listener) {
    listeners.add(listener);
    return { remove: () => void listeners.delete(listener) };
  },
};
/** Moves the app to `state` and tells its listeners, as React Native does. */
export function setAppState(state: 'active' | 'background') {
  AppState.currentState = state;
  for (const listener of [...listeners]) listener(state);
}
export const cleanups: (() => void)[] = [];
export function useEffect(effect: () => void | (() => void)) {
  const cleanup = effect();
  if (cleanup) cleanups.push(cleanup);
}
