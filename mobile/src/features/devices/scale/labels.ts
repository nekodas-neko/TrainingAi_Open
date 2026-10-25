import { formatKg } from '@trainingai/shared/format/units';
import type { ScaleState } from './ScaleSession.ts';
import type { ScaleVerdict } from './ScaleOutbox.ts';

/** How the current app's weigh-in toast words each outcome (`capacitor-native-init.tsx`). */
export type WeighResult =
  | { kind: 'logged'; weightKg: number; additional: boolean }
  | { kind: 'skipped'; weightKg: number; reason: 'impedance' | 'profile' }
  | { kind: 'pending'; weightKg: number }
  | { kind: 'declined'; weightKg: number }
  | { kind: 'failed' }
  | { kind: 'saved' };

export function resultOfVerdict(verdict: ScaleVerdict, fallbackKg: number): WeighResult {
  const weightKg = verdict.weightKg ?? fallbackKg;
  if (verdict.status === 'pending') return { kind: 'pending', weightKg };
  if (verdict.status === 'dismissed') return { kind: 'declined', weightKg };
  if (verdict.compositionSkipped)
    return {
      kind: 'skipped',
      weightKg,
      reason: verdict.compositionSkippedReason ?? 'impedance',
    };
  return {
    kind: 'logged',
    weightKg,
    additional: verdict.isAdditionalReadingForDay === true,
  };
}

export function resultText(result: WeighResult): { title: string; description?: string } {
  switch (result.kind) {
    case 'logged':
      return {
        title: `${formatKg(result.weightKg)} logged`,
        description: result.additional ? 'Additional reading today' : undefined,
      };
    case 'skipped':
      return {
        title: `${formatKg(result.weightKg)} logged`,
        description:
          result.reason === 'profile'
            ? 'Body composition skipped — add your height, birth date and sex to your profile'
            : 'Body composition skipped — stand barefoot on the plates',
      };
    case 'pending':
      return {
        title: `${formatKg(result.weightKg)} — looks different from usual`,
        description: 'Confirm it’s you under Pending weigh-ins below',
      };
    case 'declined':
      return {
        title: `${formatKg(result.weightKg)} — not filed`,
        description: 'It is far from your usual weight, so it was kept out of your trend',
      };
    case 'saved':
      return {
        title: 'Weigh-in saved on this phone',
        description: 'It will be filed when the connection is back',
      };
    case 'failed':
      return { title: 'Didn’t catch that', description: 'Step off and back on to retry' };
  }
}

/** Why the scale cannot connect, before any link state matters. Null when nothing blocks it. */
export function scaleBlocker(
  state: ScaleState,
): { title: string; message: string } | null {
  if (!state.available)
    return {
      title: 'Update TrainingAi Preview',
      message:
        'This build cannot use Bluetooth yet. Install the latest Preview to pair a scale.',
    };
  if (state.permission === 'blocked')
    return {
      title: 'Nearby devices is off for TrainingAi',
      message:
        'Allow it in Settings → Apps → TrainingAi Preview → Permissions, then come back.',
    };
  if (state.permission === 'denied' && (state.paired || state.permissionAsked))
    return {
      title: 'Bluetooth permission needed',
      message: 'TrainingAi needs Nearby devices to find and connect to your scale.',
    };
  if (state.radio === 'off')
    return {
      title: 'Bluetooth is off',
      message: 'Turn Bluetooth on to connect your scale.',
    };
  if (state.radio === 'unsupported')
    return {
      title: 'No Bluetooth',
      message: 'This phone does not support Bluetooth LE.',
    };
  return null;
}

/** The in-app banner's words while someone is on the scale, or null. */
export function weighingBannerText(state: ScaleState): string | null {
  return state.phase === 'weighing' ? scaleLinkLabel(state) : null;
}

/** The banner's words once a weigh-in is filed; null for outcomes that are answered on the Devices screen. */
export function loggedBannerText(result: WeighResult | null): string | null {
  return result?.kind === 'logged' || result?.kind === 'skipped'
    ? `${formatKg(result.weightKg)} logged`
    : null;
}

/** One line on the scale's link, as the pairing card words it. */
export function scaleLinkLabel(state: ScaleState): string {
  switch (state.phase) {
    case 'weighing':
      return state.weightKg === null
        ? 'Weighing you…'
        : `Weighing you… ${formatKg(state.weightKg)}`;
    case 'connecting':
      return 'Scale found — connecting…';
    case 'connected':
      return 'Connected — step on the scale';
    case 'listening':
      return 'Waiting for the scale — step on it to wake it';
    case 'radioOff':
      return 'Bluetooth is off';
    default:
      return 'Not connected — it connects while this screen is open';
  }
}
