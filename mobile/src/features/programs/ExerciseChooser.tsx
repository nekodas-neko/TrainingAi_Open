import { capitalize } from '@trainingai/shared/format/capitalize';
import { FlatList } from 'react-native';
import { useState } from 'react';
import {
  AppButton,
  AppText,
  Card,
  IconButton,
  ListRow,
  Badge,
  ChipPicker,
  Sheet,
  Stack,
  TextField,
} from '../../shared/ui';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { profileSpec } from '../health/data/models';
import { ExerciseMedia } from '../workouts/components/ExerciseMedia';
import type { LibraryExercise } from '../workouts/data/models';
import {
  exerciseChoices,
  exerciseAlternatives,
  exerciseEquipment,
  muscleBuckets,
} from './exercise-choice';
import { CreateExercise } from './CreateExercise';
export function ExerciseChooser({
  library,
  current,
  role,
  ownedEquipment,
  onClose,
  onSelect,
}: {
  library: LibraryExercise[];
  current?: LibraryExercise;
  role?: string | null;
  ownedEquipment?: string[];
  onClose: () => void;
  onSelect: (exercise: LibraryExercise) => void;
}) {
  const { theme } = useTheme();
  const profile = useWorkoutResource(profileSpec);
  const [query, setQuery] = useState('');
  const [equipment, setEquipment] = useState('');
  const [muscle, setMuscle] = useState('');
  const [preview, setPreview] = useState<LibraryExercise | null>(null);
  const [creating, setCreating] = useState(false);
  const alternatives =
    current && ownedEquipment
      ? exerciseAlternatives(library, current, role, ownedEquipment)
      : [];
  function choose(exercise: LibraryExercise) {
    onSelect(exercise);
    onClose();
  }
  return (
    <Sheet
      visible
      fullHeight
      scroll={creating || !!preview}
      title={creating ? 'New exercise' : (preview?.name ?? 'Choose exercise')}
      onClose={onClose}
      footer={
        preview ? (
          <AppButton title={`Select ${preview.name}`} onPress={() => choose(preview)} />
        ) : !creating && profile.data?.user.isAdmin === true ? (
          <AppButton
            title="Add new exercise"
            variant="secondary"
            onPress={() => setCreating(true)}
          />
        ) : undefined
      }
    >
      {creating ? (
        <>
          <AppButton
            title="Back to exercises"
            variant="ghost"
            onPress={() => setCreating(false)}
          />
          <CreateExercise library={library} onSelect={choose} />
        </>
      ) : preview ? (
        <>
          <AppButton
            title="Back to exercises"
            variant="ghost"
            onPress={() => setPreview(null)}
          />
          <Stack align="center">
            <ExerciseMedia name={preview.name} displaySize={theme.sizes.timerRing * 2} />
          </Stack>
          <Stack direction="row" wrap>
            {preview.equipment.map((x) => (
              <Badge key={x} label={capitalize(x)} />
            ))}
          </Stack>
          <AppText variant="eyebrow" tone="muted">
            Muscles worked
          </AppText>
          <Stack direction="row" wrap>
            {preview.muscles
              .filter((x) => x.role === 'main')
              .map((x) => (
                <Badge key={x.muscle} label={x.muscle} tone="brand" />
              ))}
          </Stack>
          <Stack direction="row" wrap>
            {preview.muscles
              .filter((x) => x.role === 'secondary')
              .map((x) => (
                <Badge key={x.muscle} label={x.muscle} />
              ))}
          </Stack>
          <AppText variant="eyebrow" tone="muted">
            How to perform
          </AppText>
          <AppText>{preview.instructions || 'No description available.'}</AppText>
        </>
      ) : (
        <>
          <TextField
            containerStyle={{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }}
            label="Search exercises"
            value={query}
            onChangeText={setQuery}
          />
          <ChipPicker
            label="Equipment"
            showLabel={false}
            horizontal
            value={equipment || null}
            options={exerciseEquipment
              .filter((x) => library.some((y) => y.equipment.includes(x)))
              .map((x) => ({ value: x, label: capitalize(x) }))}
            onChange={(value) => setEquipment(value ?? '')}
          />
          <ChipPicker
            label="Muscle group"
            showLabel={false}
            horizontal
            value={muscle || null}
            options={Object.keys(muscleBuckets).map((x) => ({ value: x, label: x }))}
            onChange={(value) => setMuscle(value ?? '')}
          />
          <FlatList
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            data={exerciseChoices(library, query, equipment, muscle)}
            keyExtractor={(item) => item.id}
            initialNumToRender={16}
            maxToRenderPerBatch={20}
            windowSize={5}
            ListHeaderComponent={
              <>
                {!query && !equipment && !muscle && !!alternatives.length && (
                  <Card>
                    <AppText variant="label">Alternatives for {current?.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      Matches your equipment, muscles and exercise role.
                    </AppText>
                    {alternatives.map((x) => (
                      <ListRow
                        key={x.id}
                        title={x.name}
                        onPress={() => choose(x)}
                        trailing={
                          <IconButton
                            icon="info"
                            label={`Preview ${x.name}`}
                            onPress={() => setPreview(x)}
                          />
                        }
                      />
                    ))}
                  </Card>
                )}
              </>
            }
            ListEmptyComponent={
              <AppText tone="muted">No exercises match these filters.</AppText>
            }
            renderItem={({ item: x }) => (
              <ListRow
                title={x.name}
                subtitle={`${x.muscles
                  .filter((y) => y.role === 'main')
                  .map((y) => y.muscle)
                  .join(', ')} · ${x.equipment.join(', ')}`}
                onPress={() => choose(x)}
                trailing={
                  <IconButton
                    icon="info"
                    label={`Preview ${x.name}`}
                    onPress={() => setPreview(x)}
                  />
                }
              />
            )}
          />
        </>
      )}
    </Sheet>
  );
}
