import { capitalize } from '@trainingai/shared/format/capitalize';
import { useEffect, useState, type ReactNode } from 'react';
import { ExerciseChooser } from './ExerciseChooser';
import { randomUUID } from 'expo-crypto';
import {
  AppButton,
  AppText,
  Card,
  Disclosure,
  NumericStepper,
  Picker,
  Stack,
  SortableStack,
  TextField,
  IconButton,
  SwitchRow,
} from '../../shared/ui';
import { timeLimitLabel } from '@trainingai/shared/workout/duration-model';
import { View } from 'react-native';
import { useTheme } from '../../shared/theme/ThemeProvider';
import type { LibraryExercise, SavedStyle } from '../workouts/data/models';
import { selectExercise, normalizeSupersets, type ProgramDraft } from './editor-model';
import { exerciseBlocks, reorderExerciseBlocks, reorderSupersetMembers } from './reorder-model';
import { defaultStyleIdForSlot } from '@trainingai/shared/workout/default-style';

export function SessionEditor({
  draft,
  index,
  onChange,
  library,
  styles,
  ownedEquipment,
  handle,
  disabled = false,
  onRemove,
}: {
  draft: ProgramDraft;
  index: number;
  onChange: (draft: ProgramDraft) => void;
  library: LibraryExercise[];
  styles: SavedStyle[];
  ownedEquipment?: string[];
  handle?: ReactNode;
  disabled?: boolean;
  onRemove?: () => void;
}) {
  const { theme } = useTheme();
  const [choosing, setChoosing] = useState<string | null>(null);
  const session = draft.sessions[index];
  const budget = session.timeBudgetMinutes ?? 60;
  const [lastLimit, setLastLimit] = useState(budget > 0 ? budget : 60);
  const [limitInput, setLimitInput] = useState(String(budget > 0 ? budget : 60));
  useEffect(() => {
    if (budget > 0) setLimitInput(String(budget));
  }, [budget]);
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
  const blocks = exerciseBlocks(session.exercises);
  function renderExercise(item: (typeof session.exercises)[number], exerciseHandle?: ReactNode) {
    const at = session.exercises.findIndex((exercise) => exercise.id === item.id);
    return (
      <Disclosure
        key={item.id ?? at}
        compact
        title={item.exerciseName || 'Choose exercise'}
        accessibilityLabel={`${at + 1}. ${item.exerciseName || 'Choose exercise'}`}
        leading={
          <Stack direction="row" align="center" gap="xs">
            {exerciseHandle}
            <AppText variant="caption" tone="muted" style={{ width: theme.sizes.iconSmall }}>
              {at + 1}.
            </AppText>
          </Stack>
        }
        defaultOpen={!item.exerciseName}
      >
        <AppButton
          title={item.exerciseName || 'Choose exercise'}
          variant="surface"
          onPress={() => setChoosing(item.id!)}
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
            label: capitalize(role),
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
            title="Remove"
            variant="danger"
            onPress={() =>
              update({
                exercises: normalizeSupersets(session.exercises.filter((_, index) => index !== at)),
              })
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
                Math.max(-1, ...session.exercises.map((exercise) => exercise.supersetGroup ?? -1)) +
                  1;
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
    );
  }
  return (
    <Card style={{ padding: theme.spacing.sm }}>
      <Disclosure
        compact
        title={session.name || `Session ${index + 1}`}
        subtitle={`${session.exercises.length} ${session.exercises.length === 1 ? 'exercise' : 'exercises'} · ${timeLimitLabel(budget)}`}
        leading={handle}
      >
        <Stack
          gap="md"
          style={{ paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.sm }}
        >
          <Stack direction="row" align="flex-end" gap="md">
            <TextField
              containerStyle={{ flex: 1, minWidth: 0 }}
              label="Session name"
              value={session.name}
              onChangeText={(name) => update({ name })}
            />
            <View style={{ width: theme.sizes.touchTarget * 1.5 }}>
              <Picker
                compact
                label="Icon"
                value={session.icon ?? '💪'}
                options={['💪', '🏋️', '🦵', '🏃', '🤸', '⚡', '🔥', '🎯', '🧘'].map((icon) => ({
                  value: icon,
                  label: icon,
                }))}
                onChange={(icon) => update({ icon })}
              />
            </View>
          </Stack>
          <Stack direction="row" align="center" gap="xs">
            <SwitchRow
              compact
              inline
              label="Time limit"
              value={budget > 0}
              disabled={disabled}
              onValueChange={(enabled) => {
                if (!enabled) setLastLimit(budget);
                update({ timeBudgetMinutes: enabled ? lastLimit : 0 });
              }}
            />
            {budget > 0 ? (
              <NumericStepper
                inline
                hideLabel
                label="Time limit (minutes)"
                value={limitInput}
                min={20}
                max={180}
                step={5}
                onChange={(value) => {
                  setLimitInput(value);
                  const minutes = Number(value);
                  if (
                    value.trim() &&
                    Number.isInteger(minutes) &&
                    minutes >= 20 &&
                    minutes <= 180
                  ) {
                    update({ timeBudgetMinutes: minutes });
                  }
                }}
                onBlur={() => setLimitInput(String(budget))}
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: theme.sizes.touchTarget,
                  justifyContent: 'center',
                }}
              >
                <AppText variant="caption" tone="muted">
                  No limit
                </AppText>
              </View>
            )}
          </Stack>
          <SortableStack
            order={blocks.map((block) => block.id)}
            enabled={!disabled}
            label={(id) => {
              const block = blocks.find((item) => item.id === id)!;
              return block.exercises
                .map((item) => item.exerciseName || 'Choose exercise')
                .join(' and ');
            }}
            onChange={(order) =>
              update({ exercises: reorderExerciseBlocks(session.exercises, order) })
            }
            renderItem={(id, exerciseHandle) => {
              const block = blocks.find((item) => item.id === id)!;
              return block.exercises.length > 1 ? (
                <Card tone="brand" style={{ padding: theme.spacing.sm, gap: theme.spacing.xs }}>
                  <Stack direction="row" align="center" gap="xs">
                    {exerciseHandle}
                    <AppText variant="label">Superset · {block.exercises.length} exercises</AppText>
                  </Stack>
                  <SortableStack
                    gap={theme.spacing.xs}
                    order={block.exercises.map((item) => item.id!)}
                    enabled={!disabled}
                    label={(id) =>
                      block.exercises.find((item) => item.id === id)?.exerciseName || 'Exercise'
                    }
                    onChange={(order) =>
                      update({
                        exercises: reorderSupersetMembers(
                          session.exercises,
                          block.exercises[0].supersetGroup!,
                          order,
                        ),
                      })
                    }
                    renderItem={(id, memberHandle) =>
                      renderExercise(block.exercises.find((item) => item.id === id)!, memberHandle)
                    }
                  />
                </Card>
              ) : (
                renderExercise(block.exercises[0], exerciseHandle)
              );
            }}
          />
          <Stack direction="row" align="center">
            <AppButton
              title="Add Exercise"
              icon="plus"
              style={{ flex: 1 }}
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
            {onRemove && (
              <IconButton
                icon="delete"
                label={`Remove ${session.name || 'session'}`}
                tone="danger"
                disabled={disabled}
                onPress={onRemove}
              />
            )}
          </Stack>
        </Stack>
      </Disclosure>
      {choosing !== null && (
        <ExerciseChooser
          library={library}
          ownedEquipment={ownedEquipment}
          role={session.exercises.find((item) => item.id === choosing)?.exerciseRole}
          current={library.find(
            (x) => x.name === session.exercises.find((item) => item.id === choosing)?.exerciseName,
          )}
          onClose={() => setChoosing(null)}
          onSelect={(selected) =>
            onChange(
              selectExercise(
                draft,
                index,
                session.exercises.findIndex((item) => item.id === choosing),
                selected,
              ),
            )
          }
        />
      )}
    </Card>
  );
}
