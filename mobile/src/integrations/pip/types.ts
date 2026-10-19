import type { PipAction, PipPhase } from '../../features/workouts/pip/pip.ts';

export type Subscription = { remove(): void };
export type PictureInPicture = {
  isAvailable(): boolean;
  /** The workout screen's phase; only an active one opens the window when the app is left. */
  setPhase(phase: PipPhase): void;
  addListener(event: 'onModeChange', listener: (event: { active: boolean }) => void): Subscription;
  addListener(event: 'onAction', listener: (event: { action: PipAction }) => void): Subscription;
  /** Once a second while in the window, where JS timers do not run. */
  addListener(event: 'onTick', listener: (event: { at: number }) => void): Subscription;
};
