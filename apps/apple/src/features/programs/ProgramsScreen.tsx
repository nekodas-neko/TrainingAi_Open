import { useEffect, useState } from 'react';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  Disclosure,
  IconButton,
  Notice,
  Sheet,
  Stack,
} from '../../shared/ui';
import { WorkoutLayout } from '../workouts/components/WorkoutLayout';
import { ResourceStatus } from '../workouts/components/ResourceStatus';
import { useWorkoutResource, useTrainingSync } from '../workouts/data/WorkoutDataProvider';
import { TrainingSyncNotice } from '../workouts/components/TrainingSyncNotice';
import {
  programSpec,
  stylesSpec,
  phaseSetsSpec,
  type SavedProgram,
  type SavedStyle,
  type SavedPhaseSet,
} from '../workouts/data/models';
import { useWorkoutAction } from '../workouts/data/useWorkoutAction';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { ProgramEditor } from './ProgramEditor';
import { StyleEditor } from './StyleEditor';
import { PhaseEditor } from './PhaseEditor';
import { InjuryManager } from '../workouts/components/InjuryManager';

export function ProgramsScreen({
  onBack,
  openBuilder,
}: {
  onBack: () => void;
  openBuilder: () => void;
}) {
  const programs = useWorkoutResource(programSpec);
  const styles = useWorkoutResource(stylesSpec);
  const phases = useWorkoutResource(phaseSetsSpec);
  const action = useWorkoutAction();
  const workouts = useWorkoutContext();
  const sync = useTrainingSync();
  const [editor, setEditor] = useState<{
    kind: 'program' | 'style' | 'phase';
    id: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    kind: 'program' | 'style' | 'phase';
    id: string;
    name: string;
  } | null>(null);
  useEffect(() => {
    setEditor(null);
    setDeleting(null);
  }, [programs.resources]);
  const program = programs.data?.programs.find(
    (program) =>
      program.id === editor?.id ||
      (!!editor?.id && program.id === sync.store?.resolveProgramId(editor.id)),
  );
  const style = styles.data?.styles.find((style) => style.id === editor?.id);
  const phase = phases.data?.phaseSets.find((phase) => phase.id === editor?.id);
  async function remove() {
    if (!deleting) {
      return;
    }
    await action.run(async () => {
      const resources = programs.resources;
      if (!resources) {
        throw new Error('Sign in to delete this item.');
      }
      if (deleting.kind === 'program') {
        await resources.changes.deleteProgram(deleting.id);
        setDeleting(null);
        return;
      }
      const path =
        deleting.kind === 'style' ? '/api/progression-styles' : `/api/phase-sets/${deleting.id}`;
      await resources.write('DELETE', path, { id: deleting.id }, [
        '/api/workout-templates',
        '/api/progression-styles',
        '/api/phase-sets',
        '/api/workout-data',
      ]);
      workouts.invalidate();
      setDeleting(null);
      await Promise.all([
        resources.load(programSpec, true),
        resources.load(stylesSpec, true),
        resources.load(phaseSetsSpec, true),
      ]);
    });
  }
  if (
    editor?.kind === 'program' &&
    (!editor.id || program) &&
    (!program?.userId || program.userId === programs.resources?.connection.userId)
  ) {
    return (
      <ProgramEditor
        key={`${programs.resources?.connection.userId}:${editor.id}`}
        program={program}
        onClose={() => setEditor(null)}
      />
    );
  }
  if (editor?.kind === 'style' && (!editor.id || style)) {
    return (
      <StyleEditor
        key={`${programs.resources?.connection.userId}:${editor.id}`}
        style={style}
        onClose={() => setEditor(null)}
      />
    );
  }
  if (editor?.kind === 'phase' && (!editor.id || phase)) {
    return (
      <PhaseEditor
        key={`${programs.resources?.connection.userId}:${editor.id}`}
        phase={phase}
        onClose={() => setEditor(null)}
      />
    );
  }
  return (
    <WorkoutLayout
      title="Program"
      onBack={onBack}
      actions={
        <IconButton
          icon="refresh"
          label="Refresh programs"
          busy={programs.refreshing}
          onPress={() => {
            programs.refresh();
            styles.refresh();
            phases.refresh();
          }}
        />
      }
    >
      <ResourceStatus state={programs} refresh={programs.refresh} />
      <TrainingSyncNotice />
      {action.error && <Notice title="Program" message={action.error} />}
      <Disclosure title="Programs" defaultOpen>
        <Stack direction="row">
          <AppButton title="Create with AI" onPress={openBuilder} style={{ flex: 1 }} />
          <AppButton
            title="Create Manually"
            variant="surface"
            onPress={() => setEditor({ kind: 'program', id: null })}
            style={{ flex: 1 }}
          />
        </Stack>
        {programs.data?.programs.length === 0 && (
          <AppText tone="muted">No programs yet. Create one to get started.</AppText>
        )}
        {programs.data?.programs
          .slice()
          .sort((a, b) => Number(b.isActive) - Number(a.isActive))
          .map((program) => (
            <Card key={program.id} tone={program.isActive ? 'brand' : 'neutral'}>
              <Stack direction="row" align="center" justify="space-between">
                <AppText variant="heading" style={{ flex: 1 }}>
                  {program.name}
                </AppText>
                {program.isActive && <Badge label="Active" tone="brand" />}
                {!!sync.store?.pendingFor(programSpec.path, program.id).length && (
                  <Badge label="Upload pending" />
                )}
              </Stack>
              <Badge
                label={
                  program.phaseMode === 'ai_dynamic'
                    ? 'AI Training'
                    : program.phaseMode === 'automatic'
                      ? 'Phase Based'
                      : 'Linear'
                }
              />
              <Disclosure
                title={`${program.sessions.length} ${program.sessions.length === 1 ? 'session' : 'sessions'}`}
              >
                {program.sessions.map((session) => (
                  <Stack key={session.id} gap="xs">
                    <AppText variant="label">{session.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      {session.exercises?.map((exercise) => exercise.exerciseName).join(', ')}
                    </AppText>
                  </Stack>
                ))}
              </Disclosure>
              <Stack direction="row" wrap>
                <AppButton
                  title="Edit"
                  variant="surface"
                  onPress={() => setEditor({ kind: 'program', id: program.id })}
                />
                {!program.isActive && (
                  <AppButton
                    title="Set as active"
                    busy={action.busy}
                    onPress={() => {
                      void action.run(async () => {
                        await programs.resources?.changes.saveProgram({
                          ...program,
                          isActive: true,
                        });
                      });
                    }}
                  />
                )}
                <AppButton
                  title="Delete"
                  variant="danger"
                  onPress={() =>
                    setDeleting({ kind: 'program', id: program.id, name: program.name })
                  }
                />
              </Stack>
            </Card>
          ))}
      </Disclosure>
      <Disclosure title="Progression Sets">
        <ResourceStatus state={styles} refresh={styles.refresh} />
        <AppButton
          title="New Progression Set"
          variant="secondary"
          onPress={() => setEditor({ kind: 'style', id: null })}
        />
        {styles.data?.styles.map((style) => (
          <Card key={style.id}>
            <AppText variant="heading">{style.name}</AppText>
            <AppText variant="caption" tone="muted">
              {style.sets
                .map((set) => `${set.reps} reps @ ${set.pct}% · ${set.restSec}s`)
                .join(' / ')}
            </AppText>
            <Stack direction="row">
              <AppButton
                title="Edit"
                variant="surface"
                onPress={() => setEditor({ kind: 'style', id: style.id })}
              />
              <AppButton
                title="Delete"
                variant="danger"
                onPress={() => setDeleting({ kind: 'style', id: style.id, name: style.name })}
              />
            </Stack>
          </Card>
        ))}
      </Disclosure>
      <Disclosure title="Phase Sets">
        <ResourceStatus state={phases} refresh={phases.refresh} />
        <AppButton
          title="New Phase Set"
          variant="secondary"
          onPress={() => setEditor({ kind: 'phase', id: null })}
        />
        {phases.data?.phaseSets.map((phase) => (
          <Card key={phase.id}>
            <AppText variant="heading">{phase.name}</AppText>
            <AppText variant="caption" tone="muted">
              {phase.phases
                .map((item) => `${item.name} · ${item.durationCycles} cycles`)
                .join(' → ')}
            </AppText>
            <Stack direction="row">
              <AppButton
                title="Edit"
                variant="surface"
                onPress={() => setEditor({ kind: 'phase', id: phase.id })}
              />
              <AppButton
                title="Clone"
                variant="surface"
                busy={action.busy}
                onPress={() => {
                  void action.run(async () => {
                    await phases.resources?.write(
                      'POST',
                      '/api/phase-sets/clone',
                      {
                        phaseSetId: phase.id,
                        programName: `${phase.name} copy`,
                        includeBaseline: false,
                        overrides: {},
                      },
                      ['/api/phase-sets'],
                    );
                    await phases.resources?.load(phaseSetsSpec, true);
                  });
                }}
              />
              <AppButton
                title="Delete"
                variant="danger"
                disabled={phase.isDefault}
                onPress={() => setDeleting({ kind: 'phase', id: phase.id, name: phase.name })}
              />
            </Stack>
          </Card>
        ))}
      </Disclosure>
      <Disclosure title="Recorded injuries">
        <InjuryManager showSync={false} />
      </Disclosure>
      <Sheet visible={deleting !== null} title="Delete" onClose={() => setDeleting(null)}>
        {action.error && <Notice title="Program change" message={action.error} />}
        {deleting && (
          <ConfirmationCard
            title={`Delete ${deleting.name}?`}
            message="This removes the selected item from your account."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            busy={action.busy}
            onConfirm={() => {
              void remove();
            }}
            onCancel={() => setDeleting(null)}
          />
        )}
      </Sheet>
    </WorkoutLayout>
  );
}
