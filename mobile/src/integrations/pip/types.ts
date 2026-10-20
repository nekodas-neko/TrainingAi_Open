import type { PipAction, PipPhase, PipView } from '../../features/workouts/pip/pip.ts';

export type Subscription = { remove(): void };
export type PictureInPicture = {
  isAvailable(): boolean;
  /**
   * The workout screen's phase and what the window shows. Only an active phase opens the window
   * when the app is left; the module draws `view` natively and runs its clock.
   */
  setPhase(phase: PipPhase, view: PipView | null): void;
  addListener(event: 'onModeChange', listener: (event: { active: boolean }) => void): Subscription;
  addListener(event: 'onAction', listener: (event: { action: PipAction }) => void): Subscription;
};
