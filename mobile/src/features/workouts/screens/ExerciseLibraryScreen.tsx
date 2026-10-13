import { useState } from 'react';
import {
  AppText,
  Card,
  IconButton,
  ListRow,
  MuscleMap,
  Picker,
  Sheet,
  Stack,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { WorkoutLayout } from '../components/WorkoutLayout';
import { ResourceStatus } from '../components/ResourceStatus';
import { ExerciseHeading } from '../components/ExerciseHeading';
import { ExerciseHistory } from '../components/ExerciseHistory';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { librarySpec, type LibraryExercise } from '../data/models';

export function ExerciseLibraryScreen({ onBack }: { onBack: () => void }) {
  const state = useWorkoutResource(librarySpec);
  const { theme } = useTheme();
  const [search, setSearch] = useState('');
  const [equipment, setEquipment] = useState('all');
  const [muscle, setMuscle] = useState('all');
  const [selected, setSelected] = useState<LibraryExercise | null>(null);
  const exercises = (state.data?.exercises ?? []).filter(
    (exercise) =>
      !exercise.mergedInto &&
      exercise.name.toLowerCase().includes(search.toLowerCase()) &&
      (equipment === 'all' || exercise.equipment.includes(equipment)) &&
      (muscle === 'all' || exercise.muscles.some((item) => item.muscle === muscle)),
  );
  return (
    <WorkoutLayout
      title="Exercise library"
      onBack={onBack}
      actions={
        <IconButton
          icon="refresh"
          label="Refresh exercises"
          busy={state.refreshing}
          onPress={state.refresh}
        />
      }
    >
      <ResourceStatus state={state} refresh={state.refresh} />
      <TextField label="Search exercises" value={search} onChangeText={setSearch} />
      <Stack direction="row">
        <Picker
          label="Equipment"
          value={equipment}
          options={[
            { value: 'all', label: 'All' },
            ...[
              ...new Set(state.data?.exercises.flatMap((exercise) => exercise.equipment) ?? []),
            ].map((value) => ({ value, label: value })),
          ]}
          onChange={setEquipment}
        />
        <Picker
          label="Muscle"
          value={muscle}
          options={[
            { value: 'all', label: 'All' },
            ...[
              ...new Set(
                state.data?.exercises.flatMap((exercise) =>
                  exercise.muscles.map((item) => item.muscle),
                ) ?? [],
              ),
            ]
              .sort()
              .map((value) => ({ value, label: value })),
          ]}
          onChange={setMuscle}
        />
      </Stack>
      <AppText variant="caption" tone="muted">
        {exercises.length} exercises
      </AppText>
      {exercises.map((exercise) => (
        <ListRow
          key={exercise.id}
          title={exercise.name}
          subtitle={`${exercise.muscles
            .filter((item) => item.role === 'main')
            .map((item) => item.muscle)
            .join(', ')} · ${exercise.equipment.join(', ')}`}
          onPress={() => setSelected(exercise)}
        />
      ))}
      <Sheet
        visible={selected !== null}
        title={selected?.name ?? 'Exercise'}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <ExerciseHeading name={selected.name} />
            <Card>
              <AppText variant="caption" tone="muted">
                {selected.exerciseType === 'bodyweight' ? 'Bodyweight' : 'Weighted'} ·{' '}
                {selected.equipment.join(', ')}
              </AppText>
              {selected.instructions && <AppText>{selected.instructions}</AppText>}
            </Card>
            <Stack style={{ height: theme.sizes.timerRing * 2 }}>
              <MuscleMap assignments={selected.muscles} />
            </Stack>
            <ExerciseHistory name={selected.name} />
          </>
        )}
      </Sheet>
    </WorkoutLayout>
  );
}
