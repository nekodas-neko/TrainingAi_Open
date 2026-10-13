import { normalizeMuscle } from '@trainingai/shared/muscles';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { fuzzyScore } from '@trainingai/shared/exercise-utils';
import {
  AppButton,
  AppText,
  Card,
  ListRow,
  MultiChoice,
  Picker,
  Stack,
  StatusIndicator,
  TextField,
} from '../../shared/ui';
import { useWorkoutDraft } from '../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../workouts/data/useWorkoutAction';
import {
  LibraryExerciseSchema,
  librarySpec,
  type LibraryExercise,
} from '../workouts/data/models';
import { exerciseEquipment, exerciseMuscles } from './exercise-choice';
const schema = z.object({
  stage: z.enum(['input', 'review']).default('input'),
  name: z.string(),
  instructions: z.string(),
  main: z.array(z.string()),
  secondary: z.array(z.string()),
  equipment: z.array(z.string()),
  exerciseType: z.enum(['weighted', 'bodyweight']),
});
const generatedSchema = z.object({
  normalizedName: z.string(),
  instructions: z.string(),
  muscles: LibraryExerciseSchema.shape.muscles,
  equipment: z.array(z.string()),
});
export function CreateExercise({
  library,
  onSelect,
}: {
  library: LibraryExercise[];
  onSelect: (value: LibraryExercise) => void;
}) {
  const draft = useWorkoutDraft('create-exercise', schema, {
    stage: 'input',
    name: '',
    instructions: '',
    main: [],
    secondary: [],
    equipment: [],
    exerciseType: 'weighted',
  });
  const action = useWorkoutAction();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const value = draft.value;
  const matches = library
    .filter((x) => !x.mergedInto)
    .map((x) => ({ exercise: x, score: fuzzyScore(value.name, x.name) }))
    .filter((x) => x.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  function update(patch: Partial<typeof value>) {
    draft.setValue({ ...value, ...patch });
  }
  async function generate() {
    await action.run(async () => {
      if (!draft.resources || !value.name.trim())
        throw new Error('Enter an exercise name first.');
      const result = generatedSchema.parse(
        await draft.resources.write('POST', '/api/exercises/generate', {
          name: value.name.trim(),
        }),
      );
      if (!alive.current) return;
      update({
        stage: 'review',
        name: result.normalizedName,
        instructions: result.instructions,
        main: result.muscles.filter((x) => x.role === 'main').map((x) => x.muscle),
        secondary: result.muscles.filter((x) => x.role === 'secondary').map((x) => x.muscle),
        equipment: result.equipment,
        exerciseType: result.equipment.every((x) => x === 'bodyweight')
          ? 'bodyweight'
          : 'weighted',
      });
    });
  }
  async function save() {
    await action.run(async () => {
      const resources = draft.resources;
      if (!resources || !value.name.trim() || !value.main.length || !value.equipment.length)
        throw new Error('Enter a name, main muscle and equipment.');
      const existing = library.find(
        (x) => !x.mergedInto && x.name.toLowerCase() === value.name.trim().toLowerCase(),
      );
      if (existing) {
        onSelect(existing);
        return;
      }
      const body = {
        name: value.name.trim(),
        instructions: value.instructions.trim(),
        muscles: [
          ...value.main.map((muscle) => ({ muscle, role: 'main' })),
          ...value.secondary
            .filter((x) => !value.main.includes(x))
            .map((muscle) => ({ muscle, role: 'secondary' })),
        ],
        equipment: value.equipment,
        exerciseType: value.exerciseType,
      };
      let saved: LibraryExercise;
      try {
        saved = z
          .object({ exercise: LibraryExerciseSchema })
          .parse(
            await resources.write('POST', '/api/exercises', body, ['/api/exercise-library']),
          ).exercise;
      } catch (error) {
        await resources.load(librarySpec, true);
        const confirmed = resources
          .state(librarySpec)
          .data?.exercises.find(
            (x) => !x.mergedInto && x.name.toLowerCase() === body.name.toLowerCase(),
          );
        if (!confirmed) throw error;
        saved = confirmed;
      }
      const current = resources.state(librarySpec).data?.exercises ?? library;
      await resources.replace(librarySpec, {
        exercises: [...current.filter((x) => x.id !== saved.id), saved],
      });
      await resources.clearDraft('create-exercise');
      if (alive.current) onSelect(saved);
    });
  }
  return (
    <Stack pointerEvents={action.busy || !draft.ready ? 'none' : 'auto'}>
      <StatusIndicator
        label="Exercise"
        busy={action.busy || !draft.ready}
        error={action.error ?? draft.error}
      />
      <TextField
        label="Exercise name"
        editable={draft.ready && !action.busy}
        value={value.name}
        maxLength={120}
        onChangeText={(name) => update({ name })}
      />
      {!!matches.length && (
        <Card>
          <AppText variant="label">Similar exercises — use an existing one</AppText>
          {matches.map((x) => (
            <ListRow
              key={x.exercise.id}
              title={x.exercise.name}
              onPress={() => onSelect(x.exercise)}
            />
          ))}
        </Card>
      )}
      <AppButton
        title="Generate with AI"
        variant="secondary"
        busy={action.busy}
        disabled={!draft.ready || !value.name.trim()}
        onPress={() => void generate()}
      />
      {value.stage === 'input' ? (
        <AppButton
          title="Enter manually"
          variant="ghost"
          disabled={!draft.ready || !value.name.trim()}
          onPress={() => update({ stage: 'review' })}
        />
      ) : (
        <>
          <TextField
            label="Instructions"
            editable={draft.ready && !action.busy}
            value={value.instructions}
            multiline
            maxLength={2000}
            onChangeText={(instructions) => update({ instructions })}
          />
          <MultiChoice
            label="Main muscles"
            value={value.main}
            options={exerciseMuscles.map((x) => ({ value: normalizeMuscle(x), label: x }))}
            onChange={(main) =>
              update({ main, secondary: value.secondary.filter((x) => !main.includes(x)) })
            }
          />
          <MultiChoice
            label="Secondary muscles"
            value={value.secondary}
            options={exerciseMuscles
              .filter((x) => !value.main.includes(normalizeMuscle(x)))
              .map((x) => ({ value: normalizeMuscle(x), label: x }))}
            onChange={(secondary) => update({ secondary })}
          />
          <MultiChoice
            label="Equipment"
            value={value.equipment}
            options={exerciseEquipment.map((x) => ({ value: x, label: x }))}
            onChange={(equipment) => update({ equipment })}
          />
          <Picker
            label="Exercise type"
            value={value.exerciseType}
            options={[
              { value: 'weighted', label: 'Weighted' },
              { value: 'bodyweight', label: 'Bodyweight' },
            ]}
            onChange={(exerciseType) =>
              update({ exerciseType: exerciseType as typeof value.exerciseType })
            }
          />
          <AppButton
            title="Save & use exercise"
            busy={action.busy}
            disabled={!draft.ready}
            onPress={() => void save()}
          />
        </>
      )}
    </Stack>
  );
}
