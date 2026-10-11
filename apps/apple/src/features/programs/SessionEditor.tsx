import { randomUUID } from 'expo-crypto';
import {
  AppButton,
  AppText,
  Card,
  Disclosure,
  NumericStepper,
  Picker,
  Stack,
  TextField,
} from '../../shared/ui';
import type { LibraryExercise, SavedStyle } from '../workouts/data/models';
import { moveItem, selectExercise, type ProgramDraft } from './editor-model';
import { defaultStyleIdForSlot } from '@trainingai/shared/workout/default-style';

export function SessionEditor({
  draft,
  index,
  onChange,
  library,
  styles,
}: {
  draft: ProgramDraft;
  index: number;
  onChange: (draft: ProgramDraft) => void;
  library: LibraryExercise[];
  styles: SavedStyle[];
}) {
  const session = draft.sessions[index];
  function update(value: Partial<typeof session>) {
    onChange({
      ...draft,
      sessions: draft.sessions.map((session, position) =>
        position === index ? { ...session, ...value } : session,
      ),
    });
  }
  function exercise(at: number, value: Partial<(typeof session.exercises)[number]>) {
    update({
      exercises: session.exercises.map((exercise, index) =>
        index === at ? { ...exercise, ...value } : exercise,
      ),
    });
  }
  return (
    <Card>
      <Stack direction="row" justify="space-between">
        <AppText variant="heading">{session.name || `Session ${index + 1}`}</AppText>
        <Stack direction="row">
          <AppButton
            title="↑"
            accessibilityLabel="Move session up"
            variant="ghost"
            disabled={index === 0}
            onPress={() => onChange({ ...draft, sessions: moveItem(draft.sessions, index, -1) })}
          />
          <AppButton
            title="↓"
            accessibilityLabel="Move session down"
            variant="ghost"
            disabled={index === draft.sessions.length - 1}
            onPress={() => onChange({ ...draft, sessions: moveItem(draft.sessions, index, 1) })}
          />
        </Stack>
      </Stack>
      <TextField
        label="Session name"
        value={session.name}
        onChangeText={(name) => update({ name })}
      />
      <Picker
        label="Session icon"
        value={session.icon ?? '💪'}
        options={['💪', '🏋️', '🦵', '🏃', '🤸', '⚡', '🔥', '🎯', '🧘'].map((icon) => ({
          value: icon,
          label: icon,
        }))}
        onChange={(icon) => update({ icon })}
      />
      <NumericStepper
        label="Time budget (minutes)"
        value={String(session.timeBudgetMinutes ?? 60)}
        min={20}
        max={180}
        step={5}
        onChange={(value) => update({ timeBudgetMinutes: Number(value) })}
      />
      {session.exercises.map((item, at) => (
        <Disclosure
          key={item.id ?? at}
          title={`${at + 1}. ${item.exerciseName || 'Choose exercise'}${item.supersetGroup != null ? ' · Superset' : ''}`}
          defaultOpen={!item.exerciseName}
        >
          <Picker
            label="Exercise"
            searchable
            value={item.exerciseName}
            options={library
              .filter((exercise) => !exercise.mergedInto)
              .map((exercise) => ({
                value: exercise.name,
                label: exercise.name,
                subtitle: exercise.equipment.join(', '),
              }))}
            onChange={(name) => {
              const selected = library.find((exercise) => exercise.name === name);
              if (selected) {
                onChange(selectExercise(draft, index, at, selected));
              }
            }}
          />
          <Picker
            label="Progression set"
            value={item.styleId ?? ''}
            options={[
              { value: '', label: 'Default' },
              ...styles.map((style) => ({ value: style.id, label: style.name })),
            ]}
            onChange={(styleId) => exercise(at, { styleId: styleId || null })}
          />
          <Picker
            label="Exercise role"
            value={item.exerciseRole ?? 'accessory'}
            options={['primary', 'secondary', 'accessory'].map((role) => ({
              value: role,
              label: role[0].toUpperCase() + role.slice(1),
            }))}
            onChange={(role) =>
              exercise(at, {
                exerciseRole: role as 'primary' | 'secondary' | 'accessory',
                styleId:
                  item.styleId ??
                  defaultStyleIdForSlot(
                    draft.sessions,
                    styles,
                    role as 'primary' | 'secondary' | 'accessory',
                  ),
              })
            }
          />
          {item.muscleGroups?.length ? (
            <AppText variant="caption" tone="muted">
              {item.muscleGroups.join(', ')}
            </AppText>
          ) : null}
          <Stack direction="row">
            <AppButton
              title="↑"
              accessibilityLabel="Move exercise up"
              variant="ghost"
              disabled={at === 0}
              onPress={() =>
                update({
                  exercises: moveItem(session.exercises, at, -1).map((exercise) => ({
                    ...exercise,
                    supersetGroup: null,
                  })),
                })
              }
            />
            <AppButton
              title="↓"
              accessibilityLabel="Move exercise down"
              variant="ghost"
              disabled={at === session.exercises.length - 1}
              onPress={() =>
                update({
                  exercises: moveItem(session.exercises, at, 1).map((exercise) => ({
                    ...exercise,
                    supersetGroup: null,
                  })),
                })
              }
            />
            <AppButton
              title="Remove"
              variant="danger"
              onPress={() =>
                update({ exercises: session.exercises.filter((_, index) => index !== at) })
              }
            />
          </Stack>
          {at < session.exercises.length - 1 && (
            <AppButton
              title={
                item.supersetGroup != null &&
                item.supersetGroup === session.exercises[at + 1].supersetGroup
                  ? 'Unlink superset'
                  : 'Link with next'
              }
              variant="secondary"
              disabled={
                session.exercises[at + 1].supersetGroup != null &&
                session.exercises[at + 1].supersetGroup !== item.supersetGroup
              }
              onPress={() => {
                const linked =
                  item.supersetGroup != null &&
                  item.supersetGroup === session.exercises[at + 1].supersetGroup;
                const group =
                  item.supersetGroup ??
                  Math.max(
                    -1,
                    ...session.exercises.map((exercise) => exercise.supersetGroup ?? -1),
                  ) + 1;
                update({
                  exercises: session.exercises.map((exercise, index) =>
                    linked
                      ? exercise.supersetGroup === item.supersetGroup
                        ? { ...exercise, supersetGroup: null }
                        : exercise
                      : index === at || index === at + 1
                        ? { ...exercise, supersetGroup: linked ? null : group }
                        : exercise,
                  ),
                });
              }}
            />
          )}
        </Disclosure>
      ))}
      <AppButton
        title="Add Exercise"
        variant="secondary"
        onPress={() =>
          update({
            exercises: [
              ...session.exercises,
              {
                id: randomUUID(),
                exerciseName: '',
                styleId: defaultStyleIdForSlot(draft.sessions, styles),
                position: session.exercises.length,
              },
            ],
          })
        }
      />
    </Card>
  );
}
