import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';
import { GeneratedProgramSchema } from '@trainingai/shared/validation/generated-program';
import {
  AppButton,
  AppText,
  Card,
  Disclosure,
  Notice,
  NumericStepper,
  Picker,
  Stack,
  StepProgress,
  SwitchRow,
  TextField,
} from '../../shared/ui';
import { WorkoutLayout } from '../workouts/components/WorkoutLayout';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import {
  librarySpec,
  phaseSetsSpec,
  programSpec,
  stylesSpec,
  injurySpec,
} from '../workouts/data/models';
import { useWorkoutDraft } from '../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../workouts/data/useWorkoutAction';
import { ProgramDraftSchema, programPayload } from './editor-model';
import { BuilderInputSchema, builderSteps, generatedDraft, reviewedProgram } from './builder-model';
import { ProgramSessionList } from './ProgramSessionList';

const schema = z.object({
  inputs: BuilderInputSchema,
  step: z.number().int(),
  generated: GeneratedProgramSchema.nullable(),
  review: ProgramDraftSchema.nullable(),
  chat: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  includeBaseline: z.boolean(),
  clonedPhaseSetId: z.string().nullable(),
  phaseCycles: z.record(z.string(), z.number().int().min(1).max(52)).default({}),
});
const equipment = ['dumbbell', 'barbell', 'cable', 'kettlebell', 'full_gym'];
const muscles = [
  'Chest',
  'Lats',
  'Upper Back',
  'Lower Back',
  'Traps',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Forearms',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
];
const titles = [
  'Program Name',
  'Equipment',
  'Sessions per Week',
  'Session Length',
  'Muscle Focus',
  'Training Goal',
  'Progression Mode',
  'Phase Structure',
  'Program Length',
  'Training Schedule',
];
export function AIProgramBuilder({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const programs = useWorkoutResource(programSpec);
  const styles = useWorkoutResource(stylesSpec);
  const phases = useWorkoutResource(phaseSetsSpec);
  const library = useWorkoutResource(librarySpec);
  const injuries = useWorkoutResource(injurySpec);
  const action = useWorkoutAction();
  const [message, setMessage] = useState('');
  const draft = useWorkoutDraft<z.infer<typeof schema>>('ai-program-builder', schema, {
    inputs: {
      programName: '',
      equipment: [],
      sessionsPerWeek: 3,
      timePerSessionMinutes: 60,
      musclesToFocus: [],
      goal: 'hypertrophy' as const,
      progressionMode: 'ai' as const,
      phaseStructureName: 'AI Dynamic',
      totalWeeks: 12,
      scheduleType: 'rotation' as const,
      rotationRestAfterN: 3,
      weeklyDays: [0, 2, 4],
    },
    step: 1,
    generated: null,
    review: null,
    chat: [],
    includeBaseline: false,
    clonedPhaseSetId: null,
    phaseCycles: {},
  });
  const value = draft.value;
  const inputs = value.inputs;
  const steps = builderSteps(inputs.progressionMode);
  const position = steps.indexOf(value.step);
  function input(patch: Partial<typeof inputs>) {
    draft.setValue({ ...value, inputs: { ...inputs, ...patch } });
  }
  function toggle(list: string[], item: string) {
    return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
  }
  async function generate() {
    await action.run(async () => {
      if (!draft.resources) {
        throw new Error('Sign in to generate your program.');
      }
      if (!inputs.programName.trim() || !inputs.equipment.length || !inputs.musclesToFocus.length) {
        throw new Error('Choose a name, equipment and muscle focus.');
      }
      const result = z
        .object({ program: GeneratedProgramSchema })
        .parse(await draft.resources.write('POST', '/api/generate-program', inputs));
      const next = {
        ...value,
        generated: result.program,
        review: generatedDraft(result.program, inputs, randomUUID),
        step: 99,
        chat: [],
        clonedPhaseSetId: null,
        phaseCycles: Object.fromEntries(
          result.program.phases.map((phase, index) => [String(index), phase.durationCycles]),
        ),
      };
      await draft.resources.saveDraft('ai-program-builder', next);
      draft.setValue(next);
    });
  }
  async function chat() {
    await action.run(async () => {
      if (!value.generated || !draft.resources || !message.trim()) {
        return;
      }
      const result = z.object({ response: z.string(), program: GeneratedProgramSchema }).parse(
        await draft.resources.write('POST', '/api/builder-chat', {
          message: message.trim(),
          program: value.review
            ? reviewedProgram(
                value.generated,
                value.review,
                library.data?.exercises ?? [],
                styles.data?.styles ?? [],
              )
            : value.generated,
          chatHistory: value.chat.slice(-20),
          equipment: inputs.equipment,
          goal: inputs.goal,
          timePerSessionMinutes: inputs.timePerSessionMinutes,
        }),
      );
      const next = {
        ...value,
        generated: result.program,
        review: generatedDraft(result.program, inputs, randomUUID),
        clonedPhaseSetId: null,
        phaseCycles: Object.fromEntries(
          result.program.phases.map((phase, index) => [String(index), phase.durationCycles]),
        ),
        chat: [
          ...value.chat,
          { role: 'user' as const, content: message.trim() },
          { role: 'assistant' as const, content: result.response },
        ],
      };
      await draft.resources.saveDraft('ai-program-builder', next);
      draft.setValue(next);
      setMessage('');
    });
  }
  async function save() {
    await action.run(async () => {
      const resources = draft.resources;
      if (!resources || !value.review || !value.generated) {
        throw new Error('Generate and review a program first.');
      }
      const review = {
        ...value.review,
        id: value.review.id || randomUUID(),
        ...(value.clonedPhaseSetId ? { phaseSetId: value.clonedPhaseSetId } : {}),
      };
      const needsClone =
        inputs.progressionMode === 'phase' &&
        review.phaseSetId &&
        !value.clonedPhaseSetId &&
        (value.includeBaseline ||
          value.generated.phases.some(
            (phase, index) =>
              (value.phaseCycles[String(index)] ?? phase.durationCycles) !== phase.durationCycles,
          ));
      const clone = needsClone
        ? {
            phaseSetId: review.phaseSetId!,
            programName: review.name,
            includeBaseline: value.includeBaseline,
            overrides: value.phaseCycles,
          }
        : undefined;
      const body = programPayload(review);
      const updated = { ...value, review };
      draft.setValue(updated);
      await resources.saveDraft('ai-program-builder', updated);
      await resources.changes.saveProgram(
        { ...body.program, sessions: body.program.sessions! },
        { creating: true, clone, linkPhaseSetOwnership: !!value.clonedPhaseSetId },
      );
      await resources.clearDraft('ai-program-builder');
      onSaved();
    });
  }
  function next() {
    if (position === steps.length - 1) {
      void generate();
    } else {
      draft.setValue({ ...value, step: steps[position + 1] });
    }
  }
  const valid =
    value.step === 1
      ? !!inputs.programName.trim()
      : value.step === 2
        ? inputs.equipment.length > 0
        : value.step === 5
          ? inputs.musclesToFocus.length > 0
          : true;
  if (!draft.ready) {
    return (
      <WorkoutLayout title="Create with AI" onBack={onBack}>
        <AppText tone="muted">{draft.error ?? 'Loading saved draft…'}</AppText>
      </WorkoutLayout>
    );
  }
  return (
    <WorkoutLayout
      reorderable
      contentDisabled={action.busy}
      title={value.step === 99 ? 'Review Program' : 'Create with AI'}
      onBack={
        action.busy
          ? undefined
          : () => {
              if (value.step === 99) {
                draft.setValue({ ...value, step: steps.at(-1)! });
              } else if (position > 0) {
                draft.setValue({ ...value, step: steps[position - 1] });
              } else {
                onBack();
              }
            }
      }
      footer={
        <AppButton
          title={
            value.step === 99
              ? 'Save Program'
              : position === steps.length - 1
                ? 'Generate Program'
                : 'Next'
          }
          busy={action.busy}
          disabled={!draft.ready || !valid}
          onPress={
            value.step === 99
              ? () => {
                  void save();
                }
              : next
          }
        />
      }
    >
      {(draft.error || action.error) && (
        <Notice title="Program builder" message={draft.error ?? action.error!} />
      )}
      {value.step !== 99 && (
        <>
          <StepProgress
            steps={steps.map((step) => ({
              id: String(step),
              label: String(step),
              state:
                step === value.step
                  ? ('current' as const)
                  : steps.indexOf(step) < position
                    ? ('done' as const)
                    : ('upcoming' as const),
            }))}
          />
          <AppText variant="title">{titles[value.step - 1]}</AppText>
        </>
      )}
      {value.step === 1 && (
        <>
          <TextField
            label="Program name"
            value={inputs.programName}
            onChangeText={(programName) => input({ programName })}
            maxLength={100}
          />
          <Picker
            label="Build similar to"
            value={inputs.referenceProgramId ?? ''}
            options={[
              { value: '', label: 'No reference' },
              ...(programs.data?.programs ?? []).map((program) => ({
                value: program.id,
                label: program.name,
              })),
            ]}
            onChange={(id) => input({ referenceProgramId: id || undefined })}
          />
        </>
      )}
      {value.step === 2 && (
        <Stack>
          {equipment.map((value) => (
            <AppButton
              key={value}
              title={value === 'full_gym' ? 'Full Gym' : value[0].toUpperCase() + value.slice(1)}
              variant={inputs.equipment.includes(value) ? 'primary' : 'surface'}
              onPress={() => input({ equipment: toggle(inputs.equipment, value) })}
            />
          ))}
        </Stack>
      )}
      {value.step === 3 && (
        <NumericStepper
          label="Sessions per week"
          min={1}
          max={7}
          value={String(inputs.sessionsPerWeek)}
          onChange={(value) => input({ sessionsPerWeek: Number(value) })}
        />
      )}
      {value.step === 4 && (
        <>
          <SwitchRow
            label="No time limit"
            value={inputs.timePerSessionMinutes === null}
            onValueChange={(value) => input({ timePerSessionMinutes: value ? null : 60 })}
          />
          {inputs.timePerSessionMinutes !== null && (
            <NumericStepper
              label="Minutes per session"
              min={30}
              max={180}
              step={5}
              value={String(inputs.timePerSessionMinutes)}
              onChange={(value) => input({ timePerSessionMinutes: Number(value) })}
            />
          )}
        </>
      )}
      {value.step === 5 && (
        <Stack direction="row" wrap>
          {muscles.map((value) => (
            <AppButton
              key={value}
              title={value}
              variant={inputs.musclesToFocus.includes(value) ? 'primary' : 'surface'}
              onPress={() => input({ musclesToFocus: toggle(inputs.musclesToFocus, value) })}
            />
          ))}
        </Stack>
      )}
      {value.step === 6 && (
        <Picker
          label="Goal"
          value={inputs.goal}
          options={[
            { value: 'hypertrophy', label: 'Hypertrophy' },
            { value: 'strength+hypertrophy', label: 'Strength + Hypertrophy' },
            { value: 'powerbuilding', label: 'Powerbuilding' },
            { value: 'strength', label: 'Strength' },
          ]}
          onChange={(goal) => input({ goal: goal as typeof inputs.goal })}
        />
      )}
      {value.step === 7 && (
        <Picker
          label="Training approach"
          value={inputs.progressionMode}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'phase', label: 'Phase Based' },
            { value: 'ai', label: 'AI Training' },
          ]}
          onChange={(mode) => input({ progressionMode: mode as typeof inputs.progressionMode })}
        />
      )}
      {value.step === 8 && (
        <Picker
          label="Phase structure"
          value={inputs.phaseStructureName}
          options={(phases.data?.phaseSets ?? []).map((phase) => ({
            value: phase.name,
            label: phase.name,
          }))}
          onChange={(phaseStructureName) => input({ phaseStructureName })}
        />
      )}
      {value.step === 9 && (
        <NumericStepper
          label="Program length (weeks)"
          min={4}
          max={52}
          value={String(inputs.totalWeeks)}
          onChange={(value) => input({ totalWeeks: Number(value) })}
        />
      )}
      {value.step === 10 && (
        <>
          <Picker
            label="Schedule"
            value={inputs.scheduleType}
            options={[
              { value: 'rotation', label: 'Rotation' },
              { value: 'weekly', label: 'Weekly' },
            ]}
            onChange={(scheduleType) =>
              input({ scheduleType: scheduleType as 'rotation' | 'weekly' })
            }
          />
          {inputs.scheduleType === 'rotation' ? (
            <NumericStepper
              label="Rest after (sessions)"
              min={1}
              max={7}
              value={String(inputs.rotationRestAfterN)}
              onChange={(value) => input({ rotationRestAfterN: Number(value) })}
            />
          ) : (
            <Stack direction="row" wrap>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
                <AppButton
                  key={day}
                  title={day}
                  variant={inputs.weeklyDays.includes(index) ? 'primary' : 'surface'}
                  onPress={() =>
                    input({
                      weeklyDays: inputs.weeklyDays.includes(index)
                        ? inputs.weeklyDays.filter((day) => day !== index)
                        : [...inputs.weeklyDays, index],
                    })
                  }
                />
              ))}
            </Stack>
          )}
        </>
      )}
      {injuries.data?.some((injury) => !injury.resolvedDate) && value.step !== 99 && (
        <Notice
          title="Recorded injuries"
          message="The builder uses your recorded injuries to exclude affected exercises."
        />
      )}
      {value.step === 99 && value.review && (
        <>
          <TextField
            label="Program name"
            value={value.review.name}
            onChangeText={(name) =>
              draft.setValue({ ...value, review: { ...value.review!, name } })
            }
          />
          {value.generated?.reasoning && (
            <Disclosure title="Why this program">
              <AppText>{value.generated.reasoning}</AppText>
            </Disclosure>
          )}
          {inputs.progressionMode === 'phase' && (
            <SwitchRow
              label="Add baseline test week"
              value={value.includeBaseline}
              onValueChange={(includeBaseline) => draft.setValue({ ...value, includeBaseline })}
            />
          )}
          {inputs.progressionMode === 'ai' && (
            <SwitchRow
              label="Auto-apply AI changes"
              value={value.review.autoApplyPrescriptions ?? false}
              onValueChange={(autoApplyPrescriptions) =>
                draft.setValue({ ...value, review: { ...value.review!, autoApplyPrescriptions } })
              }
            />
          )}
          {inputs.progressionMode === 'phase' && value.generated?.phases.length ? (
            <Card>
              <AppText variant="eyebrow" tone="muted">
                Phase Progression
              </AppText>
              {value.generated.phases.map((phase, index) => (
                <NumericStepper
                  key={phase.name}
                  label={phase.name}
                  value={String(value.phaseCycles[String(index)] ?? phase.durationCycles)}
                  min={1}
                  max={52}
                  onChange={(cycles) =>
                    draft.setValue({
                      ...value,
                      phaseCycles: { ...value.phaseCycles, [String(index)]: Number(cycles) },
                      clonedPhaseSetId: null,
                    })
                  }
                />
              ))}
            </Card>
          ) : null}
          <ProgramSessionList
            draft={value.review}
            onChange={(review) => draft.setValue({ ...value, review })}
            library={library.data?.exercises ?? []}
            styles={styles.data?.styles ?? []}
            disabled={action.busy}
          />
          <Card>
            <AppText variant="heading">Adjust with AI</AppText>
            {value.chat.map((entry, index) => (
              <AppText
                key={index}
                variant="caption"
                tone={entry.role === 'assistant' ? 'muted' : 'text'}
              >
                {entry.content}
              </AppText>
            ))}
            <TextField
              label="Requested changes"
              value={message}
              onChangeText={setMessage}
              maxLength={1000}
            />
            <AppButton
              title="Send"
              busy={action.busy}
              disabled={!message.trim()}
              onPress={() => {
                void chat();
              }}
            />
          </Card>
        </>
      )}
    </WorkoutLayout>
  );
}
