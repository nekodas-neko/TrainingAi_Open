import { capitalize } from '@trainingai/shared/format/capitalize';
import { useState } from 'react';
import { AppText, ConfirmationCard, Notice, Picker, Sheet } from '../../shared/ui';
import { periodizationSpec, type SavedProgram } from '../workouts/data/models';
import { useWorkoutAction } from '../workouts/data/useWorkoutAction';
import { useWorkoutResource, useWorkoutResources } from '../workouts/data/WorkoutDataProvider';

const PHASES = ['baseline', 'accumulation', 'intensification', 'realisation', 'deload'];

/**
 * The manual phase change for an AI program (#3900). It left the workout screen: the plan moves the
 * phase by itself, and this is the rare override. One row, then the confirmation sheet the screen used
 * to open. The program's sessions share one phase (#3766), so the move is asked of its first session.
 */
export function ProgramPhaseRow({ program }: { program: SavedProgram }) {
  const sessionId = program.sessions.find((session) => session.id)?.id ?? null;
  const resources = useWorkoutResources();
  const state = useWorkoutResource(periodizationSpec(sessionId ?? 'missing'), !!sessionId);
  const action = useWorkoutAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!sessionId) {
    return null;
  }
  const current = state.data?.state?.phase;
  return (
    <>
      <AppText variant="caption" tone="muted">
        The AI plan moves the phase for you. Change it here only to override the plan.
      </AppText>
      <Picker
        label="Change phase manually"
        value=""
        display={current ? capitalize(current) : 'Choose a phase'}
        options={PHASES.map((value) => ({ value, label: capitalize(value) }))}
        disabled={action.busy || !resources}
        onChange={setConfirm}
      />
      <Sheet visible={confirm !== null} title="Change phase" onClose={() => setConfirm(null)}>
        {action.error && <Notice title="Prescription" message={action.error} />}
        {confirm && (
          <ConfirmationCard
            title={`Change the phase to ${confirm}?`}
            message="This changes the program's training phase and regenerates this session's prescription. While the program's sessions are still on their own phases, only this session moves."
            confirmLabel="Change phase"
            cancelLabel="Cancel"
            busy={action.busy}
            onConfirm={() => {
              void action
                .run(async () => {
                  if (!resources) {
                    throw new Error('Sign in to change the phase.');
                  }
                  const base = `/api/ai-periodization/session/${sessionId}`;
                  const invalidate = ['/api/workout-data', '/api/ai-periodization', '/api/next-session'];
                  // The lifter's own pick, so it moves the phase even over a one-day deload (#3799).
                  await resources.write('POST', `${base}/transition`, { newPhase: confirm, force: true }, invalidate);
                  await resources.write('POST', `${base}/prescribe`, { durationPreset: 'standard' }, invalidate);
                  await resources.load(periodizationSpec(sessionId), true);
                })
                .then((saved) => {
                  if (saved) {
                    setConfirm(null);
                  }
                });
            }}
            onCancel={() => setConfirm(null)}
          />
        )}
      </Sheet>
    </>
  );
}
