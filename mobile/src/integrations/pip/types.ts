import type { PipAction, PipPhase } from '../../features/workouts/pip/pip.ts';
import type { WorkoutStatusPayload } from '../workout-status/types.ts';

export type Subscription = { remove(): void };
export type PictureInPicture = {
  isAvailable(): boolean;
  /**
   * The workout screen's phase and what the window shows. Only an active phase opens the window
   * when the app is left; the module draws `status` (the notification's payload) natively and runs
   * its clocks. `setColor` is the running set's arc colour.
   */
  setPhase(phase: PipPhase, status: WorkoutStatusPayload | null, setColor: string | null): void;
  /**
   * Where the window shrinks out of, in dp from the top left of the window, or nulls for none. It
   * only shapes the enter animation (the system's source rect hint).
   */
  setSourceRect(
    left: number | null,
    top: number | null,
    right: number | null,
    bottom: number | null,
  ): void;
  addListener(event: 'onModeChange', listener: (event: { active: boolean }) => void): Subscription;
  addListener(event: 'onAction', listener: (event: { action: PipAction }) => void): Subscription;
};
