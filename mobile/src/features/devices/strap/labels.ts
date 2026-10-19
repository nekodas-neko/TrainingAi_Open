import {
  HR_MAX_PLAUSIBLE,
  HR_MIN_PLAUSIBLE,
  rollingMedian,
} from '@trainingai/shared/health/hr-smoothing';
import { computeHrZones, zoneForBpm } from '@trainingai/shared/health/hr-zones';
import { STALE_MS, type StrapState } from './StrapSession.ts';

/** Why the strap cannot connect, before any link state matters. Null when nothing blocks it. */
export function strapBlocker(state: StrapState): { title: string; message: string } | null {
  if (!state.available)
    return {
      title: 'Update TrainingAi Preview',
      message: 'This build cannot use Bluetooth yet. Install the latest Preview to pair a strap.',
    };
  if (state.permission === 'blocked')
    return {
      title: 'Nearby devices is off for TrainingAi',
      message: 'Allow it in Settings → Apps → TrainingAi Preview → Permissions, then come back.',
    };
  // Before the first prompt Android reports the same 'denied'; pairing asks, so that is no blocker.
  if (state.permission === 'denied' && (state.paired || state.permissionAsked))
    return {
      title: 'Bluetooth permission needed',
      message: 'TrainingAi needs Nearby devices to find and connect to your strap.',
    };
  if (state.radio === 'off')
    return { title: 'Bluetooth is off', message: 'Turn Bluetooth on to connect your strap.' };
  if (state.radio === 'unsupported')
    return { title: 'No Bluetooth', message: 'This phone does not support Bluetooth LE.' };
  return null;
}

/** One line on the strap's link, as the current app's pairing card words it. */
export function strapLinkLabel(state: StrapState): string {
  switch (state.link) {
    case 'connected':
      return state.worn ? 'Connected · on your chest' : 'Connected · no chest contact';
    case 'connecting':
      return 'Connecting…';
    case 'waiting':
      return 'Strap not reachable — retrying';
    case 'radioOff':
      return 'Bluetooth is off';
    default:
      return 'Not connected — it connects during workouts';
  }
}

/**
 * The rest-screen Live HR card, as the current app's `LiveHrChart` computes it: the rest window of
 * the workout's plausible readings, a 3-sample rolling median, the last smoothed value as the big
 * number, and its zone. The last reading is held (dimmed) across gaps rather than blanked.
 */
export function liveHrView(
  state: StrapState,
  now: number,
  sinceMs: number | null,
  profile: { maxHr: number; restingHr: number } | null,
) {
  const samples = sinceMs === null ? state.trace : state.trace.filter((x) => x.at >= sinceMs);
  const smoothed = rollingMedian(
    samples.map((x) => x.bpm),
    3,
  );
  // Without a trace the raw reading stands in, unless it is a strap-on 0 or another non-heartbeat.
  const raw =
    state.bpm !== null && state.bpm >= HR_MIN_PLAUSIBLE && state.bpm <= HR_MAX_PLAUSIBLE
      ? state.bpm
      : null;
  const bpm = smoothed.length ? smoothed[smoothed.length - 1] : raw;
  const live =
    bpm !== null &&
    state.bpmAt !== null &&
    state.link === 'connected' &&
    state.worn &&
    now - state.bpmAt < STALE_MS;
  const zone = profile && bpm !== null ? zoneForBpm(bpm, computeHrZones(profile)) : null;
  return {
    bpm,
    live,
    stale: bpm !== null && !live,
    zone,
    points: samples.map((x, index) => ({ at: x.at, bpm: smoothed[index] })),
    message: live ? 'Reading…' : bpm !== null ? 'Holding last reading…' : 'Waiting for your strap…',
  };
}
