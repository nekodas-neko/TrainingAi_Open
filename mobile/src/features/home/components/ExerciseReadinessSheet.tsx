import { useEffect, useMemo, useState } from 'react';
import { suggestedSoreMuscles } from '@trainingai/shared/checkin/suggested-soreness';
import { computePerExerciseDeload } from '@trainingai/shared/ai-periodization/per-exercise-deload';
import { moodMuscleMatches } from '@trainingai/shared/muscles';
import {
  AppButton,
  AppText,
  ChoiceTiles,
  Disclosure,
  MultiChoice,
  MuscleMap,
  Sheet,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useHome } from '../data/HomeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { recoverySpec } from '../../health/data/models';
import type { Mood } from '../data/models';
import type { SessionPreview } from '../../workouts/catalog';
import { View } from 'react-native';
import type { MoodFields } from '@trainingai/shared/validation/mood-log';
import { SessionLengthControl } from '../../workouts/components/SessionLengthControl';

const groups = [
  { label: 'Upper', muscles: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
  { label: 'Lower', muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
  { label: 'Core', muscles: ['Core'] },
];
export function ExerciseReadinessSheet({
  onClose,
  session,
}: {
  onClose: () => void;
  session?: SessionPreview;
}) {
  const home = useHome();
  const { today } = useHealthData();
  const recovery = useWorkoutResource(recoverySpec);
  const [energy, setEnergy] = useState<Mood['energyLevel'] | null>(
    home.mood?.energyLevel ?? null,
  );
  const [muscles, setMuscles] = useState<string[]>(home.mood?.soreMuscles ?? []);
  const [issues, setIssues] = useState<string[]>(
    home.mood?.bodyState.filter((value) => ['stiff', 'joint_pain', 'sick'].includes(value)) ??
      [],
  );
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestions = useMemo(
    () =>
      suggestedSoreMuscles(
        recovery.data?.muscles.filter((row) => row.hoursAgo !== null) as
          | { muscle: string; hoursAgo: number; pct: number }[]
          | undefined,
        groups.flatMap((group) => group.muscles),
      ),
    [recovery.data],
  );
  useEffect(() => {
    if (!home.mood && !touched) {
      setMuscles(suggestions);
    }
  }, [suggestions, touched]);
  const assignments = useMemo(
    () => muscles.map((muscle) => ({ muscle, role: 'secondary' as const })),
    [muscles],
  );
  const sessionMuscles =
    session?.muscleActivations?.map((row) => row.muscle) ??
    session?.exercises.flatMap((row) => row.muscles) ??
    [];
  const overlap = muscles.filter((muscle) =>
    sessionMuscles.some((target) => moodMuscleMatches(target, muscle)),
  );
  const deload = computePerExerciseDeload(
    session?.exercises.map((exercise) => ({
      sessionExerciseId: exercise.id,
      name: exercise.name,
      muscleAssignments: (exercise.mainMuscles ?? []).map((muscle) => ({
        muscle,
        role: 'main' as const,
      })),
    })) ?? [],
    muscles,
    'strength',
    'accumulation',
  );
  async function save() {
    if (!energy || !home.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await home.store.saveMood(today, {
        energyLevel: energy,
        bodyState: [
          ...issues,
          ...(muscles.length ? ['sore_muscles'] : []),
        ] as MoodFields['bodyState'],
        soreMuscles: muscles,
        suggestedSoreMuscles: suggestions,
      });
      onClose();
    } catch {
      setError('Could not save your energy on this phone. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      fullHeight
      title="Exercise Readiness"
      onClose={onClose}
      actions={<StatusIndicator label="Exercise readiness" error={error} />}
      footer={
        <AppButton
          title="Save Readiness"
          disabled={!energy || !home.ready || home.denied}
          busy={busy}
          onPress={() => void save()}
        />
      }
    >
      <AppText tone="muted">
        Log today’s energy and any muscle soreness so the AI can calibrate your session.
      </AppText>
      <ChoiceTiles
        label="Energy Level"
        value={energy}
        onChange={setEnergy}
        options={[
          { value: 'drained', label: 'Drained', emoji: '😴' },
          { value: 'low', label: 'Low', emoji: '😑' },
          { value: 'ok', label: 'OK', emoji: '😐' },
          { value: 'good', label: 'Good', emoji: '😊' },
          { value: 'pumped', label: 'Pumped', emoji: '⚡' },
        ]}
      />
      <AppText variant="label">
        Sore Muscles{muscles.length ? ` · ${muscles.length}` : ''}
      </AppText>
      <Stack direction="row" align="center">
        <View style={{ flex: 1 }}>
          <MuscleMap assignments={assignments} />
        </View>
        <Stack style={{ flex: 1 }}>
          {groups.map((group) => (
            <MultiChoice
              key={group.label}
              label={group.label}
              value={muscles}
              options={group.muscles.map((value) => ({
                value,
                label: `${value}${suggestions.includes(value) ? ' ↻' : ''}${sessionMuscles.some((target) => moodMuscleMatches(target, value)) ? ' •' : ''}`,
              }))}
              onChange={(next) => {
                setTouched(true);
                setMuscles(next);
              }}
            />
          ))}
        </Stack>
      </Stack>
      {suggestions.length > 0 && (
        <AppText variant="caption" tone="muted">
          Suggested from recent training: {suggestions.join(', ')}. Change anything that doesn’t
          match how you feel.
        </AppText>
      )}
      {overlap.length > 0 && (
        <AppText variant="caption" tone="muted">
          {overlap.join(' & ')} {overlap.length === 1 ? 'is' : 'are'} sore and in today’s
          session —{' '}
          {deload.outcome === 'whole_session'
            ? 'over half the session is affected, so the whole session will be lightened.'
            : 'those exercises will be lightened.'}
        </AppText>
      )}
      <Disclosure title="Other issues">
        <MultiChoice
          label="How your body feels"
          value={issues}
          onChange={setIssues}
          options={[
            { value: 'stiff', label: 'Stiff / Tight' },
            { value: 'joint_pain', label: 'Joint Pain' },
            { value: 'sick', label: 'Sick / Unwell' },
          ]}
        />
      </Disclosure>
      {issues.includes('sick') && (
        <AppText variant="caption" tone="muted">
          Feeling unwell — a rest day will be recommended. If you train anyway, today’s session
          is deloaded.
        </AppText>
      )}
      {session && session.budgetMinutes != null && <SessionLengthControl session={session} />}
    </Sheet>
  );
}
