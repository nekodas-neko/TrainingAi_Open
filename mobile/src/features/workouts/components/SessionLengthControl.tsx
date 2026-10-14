import { useEffect, useRef, useState } from 'react';
import {
  budgetForPreset,
  presetForLength,
  sessionTimeLimitOptions,
  timeLimitLabel,
  type DurationPreset,
} from '@trainingai/shared/workout/duration-model';
import { AppText, ChoiceTiles, Stack, StatusIndicator } from '../../../shared/ui';
import type { SessionPreview } from '../catalog';
import { useWorkoutResource, useWorkoutResources } from '../data/WorkoutDataProvider';
import { periodizationSpec } from '../data/models';
export function SessionLengthControl({ session }: { session: SessionPreview }) {
  const resources = useWorkoutResources();
  const state = useWorkoutResource(periodizationSpec(session.id));
  const budget = session.budgetMinutes ?? 60;
  const [preset, setPreset] = useState<DurationPreset>('standard');
  const chosen = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const saved = state.data?.state?.prescription?.durationPreset;
    if (
      !chosen.current &&
      (typeof saved === 'number' || saved === 'standard' || saved === 'short' || saved === 'long')
    ) {
      setPreset(saved);
    }
  }, [state.data]);
  async function change(min: number) {
    if (!resources || busy) {
      return;
    }
    const previous = preset;
    const next = presetForLength(budget, min);
    chosen.current = true;
    setPreset(next);
    setBusy(true);
    setError(null);
    try {
      await resources.write(
        'POST',
        `/api/ai-periodization/session/${session.id}/prescribe`,
        { durationPreset: next },
        ['/api/ai-periodization', '/api/workout-data', '/api/next-session'],
      );
      await resources.load(periodizationSpec(session.id), true);
    } catch {
      setPreset(previous);
      setError('Could not rebuild today’s plan for that length. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <ChoiceTiles
        label="Time limit today"
        value={budgetForPreset(budget, preset)}
        disabled={busy}
        options={sessionTimeLimitOptions(budget).map((value) => ({
          value,
          label: timeLimitLabel(value),
          caption: value === budget ? 'usual' : ' ',
        }))}
        onChange={(value) => void change(value)}
      />
      <AppText variant="caption" tone="muted">
        Changes today’s plan only — sets and exercises are rebalanced against your weekly volume.
      </AppText>
      <StatusIndicator label="Session length" busy={busy} error={error} />
    </Stack>
  );
}
