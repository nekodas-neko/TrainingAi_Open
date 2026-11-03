import { supportsCadence } from '@trainingai/shared/health/cadence';
import type { StrapState } from '../../devices/strap/StrapSession.ts';

/**
 * Whether a recording shows the strap's live step rate, and so asks for its accelerometer: while it
 * is running (not before the start, not paused, not done) and its type is one with a step rate.
 *
 * The type list is the shared `supportsCadence` (walk, run, hike, treadmill), not `isDistanceBased`:
 * a treadmill is not distance-based but is pure foot cadence, and a cycle is distance-based with no
 * step rate. A guided walk is a walk or a treadmill, so it is covered; any other guided kind (a
 * fitness test) and a gym workout are not.
 */
export function wantsLiveCadence(session: {
  mode: string;
  pauseStartMs: number | null;
  type: { id: string };
  guidance?: { kind: string } | null;
}): boolean {
  return (
    session.mode === 'active' &&
    session.pauseStartMs === null &&
    supportsCadence(session.type.id) &&
    (!session.guidance || session.guidance.kind === 'walk')
  );
}

/** What the cadence line says: the whole-number rate, or why there is none yet. */
export function cadenceReadout(
  state: Pick<StrapState, 'link' | 'accel'>,
  spm: number | null,
): { spm: number } | { waiting: string } {
  if (spm !== null) return { spm: Math.round(spm) };
  if (state.accel === 'unavailable') return { waiting: 'The strap isn’t sending step data' };
  if (state.link !== 'connected') return { waiting: 'Waiting for your strap…' };
  return { waiting: 'Reading your steps…' };
}
