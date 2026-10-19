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

/** The live reading: held and dimmed once stale, never shown off the chest. */
export function liveBpm(state: StrapState, now: number) {
  if (state.bpm === null || state.bpmAt === null || state.link !== 'connected' || !state.worn)
    return { bpm: null, live: false };
  const live = now - state.bpmAt < STALE_MS;
  return { bpm: state.bpm, live };
}
