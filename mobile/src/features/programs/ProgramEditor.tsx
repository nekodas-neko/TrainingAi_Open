import { capitalize } from '@trainingai/shared/format/capitalize';
import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Notice,
  NumericStepper,
  Picker,
  SwitchRow,
  TextField,
  WeekdayPicker,
} from '../../shared/ui';
import { WorkoutLayout } from '../workouts/components/WorkoutLayout';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { librarySpec, phaseSetsSpec, stylesSpec, type SavedProgram } from '../workouts/data/models';
import { useWorkoutDraft } from '../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../workouts/data/useWorkoutAction';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { ProgramDraftSchema, programDraft, programPayload } from './editor-model';
import { ProgramSessionList } from './ProgramSessionList';

export function ProgramEditor({
  program,
  initial,
  onClose,
}: {
  program?: SavedProgram;
  initial?: ReturnType<typeof programDraft>;
  onClose: () => void;
}) {
  const library = useWorkoutResource(librarySpec);
  const styles = useWorkoutResource(stylesSpec);
  const phases = useWorkoutResource(phaseSetsSpec);
  const workouts = useWorkoutContext();
  const [draftId] = useState(program?.id ?? 'new');
  const [newId] = useState(randomUUID);
  const key = `program-editor:${draftId}`;
  const draft = useWorkoutDraft(key, ProgramDraftSchema, initial ?? programDraft(program));
  const action = useWorkoutAction();
  const value = draft.value;
  const mode = value.phaseMode === 'ai_dynamic' ? 'ai' : (value.schedule?.type ?? 'auto');
  async function save() {
    await action.run(async () => {
      const resources = draft.resources;
      if (!resources) {
        throw new Error('Sign in to save this program.');
      }
      const savedDraft = { ...value, id: value.id || newId };
      const body = programPayload(savedDraft);
      draft.setValue(savedDraft);
      await resources.saveDraft(key, savedDraft);
      await resources.changes.saveProgram(
        { ...body.program, sessions: body.program.sessions! },
        { creating: !program },
      );
      await resources.clearDraft(key);
      onClose();
    });
  }
  return (
    <WorkoutLayout
      reorderable
      contentDisabled={action.busy}
      title={program ? 'Edit Program' : 'New Program'}
      onBack={action.busy ? undefined : onClose}
      footer={
        <AppButton
          title="Save Program"
          busy={action.busy}
          disabled={!draft.ready}
          onPress={() => {
            void save();
          }}
        />
      }
    >
      {(draft.error || action.error) && (
        <Notice title="Program not saved" message={draft.error ?? action.error!} />
      )}
      {!draft.ready ? (
        <AppText tone="muted">Loading saved draft…</AppText>
      ) : (
        <>
          <TextField
            label="Program name"
            value={value.name}
            onChangeText={(name) => draft.setValue({ ...value, name })}
          />
          <AppText variant="eyebrow" tone="muted">
            Training Schedule
          </AppText>
          <Picker
            label="Schedule"
            value={mode}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'rotation', label: 'Rotation' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'ai', label: 'AI' },
            ]}
            onChange={(mode) =>
              draft.setValue({
                ...value,
                phaseMode:
                  mode === 'ai'
                    ? 'ai_dynamic'
                    : value.phaseMode === 'ai_dynamic'
                      ? 'manual'
                      : value.phaseMode,
                schedule:
                  mode === 'weekly'
                    ? {
                        ...value.schedule,
                        type: 'weekly',
                        days: value.schedule?.days ?? [0, 2, 4].map((dayOfWeek) => ({ dayOfWeek })),
                      }
                    : mode === 'rotation'
                      ? {
                          ...value.schedule,
                          type: 'rotation',
                          restAfterN: value.schedule?.restAfterN ?? 3,
                        }
                      : null,
              })
            }
          />
          {mode === 'rotation' && (
            <NumericStepper
              label="Rest after (sessions)"
              min={1}
              max={14}
              value={String(value.schedule?.restAfterN ?? 3)}
              onChange={(next) =>
                draft.setValue({
                  ...value,
                  schedule: { ...value.schedule, type: 'rotation', restAfterN: Number(next) },
                })
              }
            />
          )}
          {mode === 'weekly' && (
            <Card>
              <AppText variant="caption" tone="muted">
                Tap days you train. Unticked days are rest days.
              </AppText>
              <WeekdayPicker
                value={value.schedule?.days?.map((day) => day.dayOfWeek) ?? []}
                onToggle={(day) => draft.setValue({
                  ...value,
                  schedule: {
                    ...value.schedule,
                    type: 'weekly',
                    days: value.schedule?.days?.some((item) => item.dayOfWeek === day)
                      ? value.schedule.days.filter((item) => item.dayOfWeek !== day)
                      : [...(value.schedule?.days ?? []), { dayOfWeek: day }],
                  },
                })}
              />
            </Card>
          )}
          {mode === 'ai' ? (
            <Card>
              <Picker
                label="Training goal"
                value={value.trainingGoal ?? 'strength'}
                options={[
                  'strength',
                  'powerbuilding',
                  'strength+hypertrophy',
                  'hypertrophy',
                  'power',
                  'endurance',
                ].map((goal) => ({ value: goal, label: capitalize(goal) }))}
                onChange={(trainingGoal) => draft.setValue({ ...value, trainingGoal })}
              />
              <SwitchRow
                label="Auto-apply AI changes"
                value={value.autoApplyPrescriptions ?? false}
                onValueChange={(autoApplyPrescriptions) =>
                  draft.setValue({ ...value, autoApplyPrescriptions })
                }
              />
            </Card>
          ) : (
            <>
              <AppText variant="eyebrow" tone="muted">
                Training Approach
              </AppText>
              {program ? (
                <Badge label={value.phaseMode === 'automatic' ? 'Phase Based' : 'Linear'} />
              ) : (
                <Picker
                  label="Approach"
                  value={value.phaseMode ?? 'manual'}
                  options={[
                    { value: 'manual', label: 'Linear' },
                    { value: 'automatic', label: 'Phase Based' },
                  ]}
                  onChange={(phaseMode) =>
                    draft.setValue({ ...value, phaseMode: phaseMode as 'manual' | 'automatic' })
                  }
                />
              )}
              {value.phaseMode === 'automatic' && (
                <Picker
                  label="Phase Set"
                  value={value.phaseSetId ?? ''}
                  options={[
                    { value: '', label: 'Choose phase set' },
                    ...(phases.data?.phaseSets ?? []).map((phase) => ({
                      value: phase.id,
                      label: phase.name,
                    })),
                  ]}
                  onChange={(phaseSetId) =>
                    draft.setValue({ ...value, phaseSetId: phaseSetId || null })
                  }
                />
              )}
            </>
          )}
          {program && value.phaseMode === 'automatic' && (
            <AppButton
              title="Recalculate cycle position"
              variant="ghost"
              busy={action.busy}
              onPress={() => {
                void action.run(async () => {
                  await draft.resources?.write(
                    'POST',
                    '/api/workout-templates',
                    { recalibrateCycleAnchor: true, programId: program.id },
                    ['/api/workout-templates', '/api/workout-data'],
                  );
                  workouts.invalidate();
                }, 'Cycle position recalculated.');
              }}
            />
          )}
          {action.message && <Notice title="Program" message={action.message} />}
          <AppText variant="eyebrow" tone="muted">
            Sessions & exercises
          </AppText>
          <ProgramSessionList
            draft={value}
            onChange={draft.setValue}
            library={library.data?.exercises ?? []}
            styles={styles.data?.styles ?? []}
            removable
            disabled={action.busy}
          />
          <AppButton
            title="Add Session"
            variant="secondary"
            onPress={() =>
              draft.setValue({
                ...value,
                sessions: [
                  ...value.sessions,
                  {
                    id: randomUUID(),
                    name: '',
                    position: value.sessions.length,
                    timeBudgetMinutes: 0,
                    icon: '💪',
                    exercises: [],
                  },
                ],
              })
            }
          />
        </>
      )}
    </WorkoutLayout>
  );
}
