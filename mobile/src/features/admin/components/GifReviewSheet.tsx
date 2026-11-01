import { useState } from 'react';
import { View } from 'react-native';
import { AppButton, AppText, Notice, Sheet, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { ExerciseMedia } from '../../workouts/components/ExerciseMedia';
import { failureNotice } from '../../../core/reporting/index.ts';
import { adminMediaReviewSpec } from '../data/admin-content';

type Candidate = { name: string; muscles: string[]; equipment: string[] };

/**
 * Judge the catalogue's GIFs one at a time, big, with the name and target muscles beside it.
 * Marking one wrong fires no AI call: it records the verdict so the set can be decided about.
 */
export function GifReviewSheet({
  candidates,
  onClose,
}: {
  candidates: readonly Candidate[];
  onClose: () => void;
}) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const [index, setIndex] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = candidates[index];

  async function judge(status: 'ok' | 'wrong') {
    if (!resources || !current || saving) return;
    setSaving(true);
    setError(null);
    try {
      await resources.write(
        'PATCH',
        '/api/admin/exercise-media-review',
        { exerciseName: current.name, gender: 'male', status },
        [adminMediaReviewSpec.path],
      );
      if (status === 'wrong') setWrong((n) => n + 1);
      setIndex((i) => i + 1);
    } catch (failure) {
      // Never advance on a failure: skipping past an unrecorded verdict is how a sweep ends up
      // claiming to have covered the catalogue when it has not.
      setError(failureNotice('Couldn’t save that verdict.', failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet
      visible
      fullHeight
      title={current ? `Reviewing ${index + 1} of ${candidates.length}` : 'Sweep complete'}
      onClose={onClose}
    >
      {current ? (
        <Stack style={{ alignItems: 'center' }}>
          <ExerciseMedia key={current.name} name={current.name} displaySize={300} />
          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <AppText variant="heading">{current.name}</AppText>
            <AppText variant="caption" tone="muted">
              {current.muscles.join(', ') || 'No muscles recorded'}
              {current.equipment.length > 0 ? ` · ${current.equipment.join(', ')}` : ''}
            </AppText>
          </View>
          {error && <Notice title="Not saved" message={error} error />}
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignSelf: 'stretch' }}>
            <AppButton title="Wrong" variant="danger" icon="close" disabled={saving} style={{ flex: 1 }} onPress={() => void judge('wrong')} />
            <AppButton title="Looks right" icon="check" busy={saving} style={{ flex: 1 }} onPress={() => void judge('ok')} />
          </View>
          <AppButton title="Finish later" variant="ghost" onPress={onClose} />
        </Stack>
      ) : (
        <Stack>
          <AppText>
            {candidates.length === 0
              ? 'Nothing left to review.'
              : `Judged ${candidates.length}, flagged ${wrong} as wrong.`}
          </AppText>
          <AppText variant="caption" tone="muted">
            The flagged ones are recorded against each exercise’s media row. Nothing was regenerated.
          </AppText>
          <AppButton title="Close" onPress={onClose} />
        </Stack>
      )}
    </Sheet>
  );
}
