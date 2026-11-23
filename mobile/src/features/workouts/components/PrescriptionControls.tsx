import {
  sessionTimeLimitOptions,
  budgetForPreset,
  timeLimitLabel,
  readDurationPreset,
} from '@trainingai/shared/workout/duration-model';
import { todayInTz } from '@trainingai/shared/date-utils';
import { AppButton, AppText, Card, Notice, Picker, Stack } from '../../../shared/ui';
import { useSessionPreparation } from '../data/useSessionPreparation';
import type { PlanStartModel } from '../data/plan-start';
import { useWorkoutContext } from '../WorkoutProvider';
import { dailyCheckStrip } from '../../home/data/recommendation-reasons';
import { DeloadStrip } from '../../home/components/DeloadStrip';
import { useHomeState } from '../../home/data/HomeProvider';
import { PlanStartCard } from './PlanStartCard';
import { failureNotice } from '../../../core/reporting/index.ts';
import { useState } from 'react';

/**
 * The AI program's pre-workout body (#3900, mockup 1A): the day's plan and, above it, a rest or swap
 * suggestion with its own button. Start and "Deload today instead" are in the screen footer. Accept,
 * Dismiss, Regenerate, the phase picker and the Full / Deload switch are gone: the plan is applied, and
 * a manual phase change is on the Program screen.
 */
export function PrescriptionControls({
  preparation,
  model,
  onSelect,
}: {
  preparation: ReturnType<typeof useSessionPreparation>;
  model: PlanStartModel;
  onSelect: (id: string) => void;
}) {
  const action = preparation.action;
  const workout = useWorkoutContext();
  const home = useHomeState();
  const [restError, setRestError] = useState<string | null>(null);
  const prescription = preparation.prescribedState?.prescription;
  // Today's rest-or-lighter call is the app's daily check, the one Home's strip shows.
  const strip = dailyCheckStrip(workout.catalog?.recommendation);
  const blocked =
    preparation.session?.exercises
      .filter((exercise) => exercise.deloaded && !exercise.preDeloadStyle?.length)
      .map((exercise) => exercise.name) ?? [];
  const suggestion = model.suggestion;
  return (
    <>
      {strip && <DeloadStrip strip={strip} />}
      {suggestion && (
        <Card tone="brand">
          <AppText variant="label">{suggestion.title}</AppText>
          <AppText variant="caption" tone="muted">
            {suggestion.message}
          </AppText>
          {suggestion.action && (
            <Stack direction="row">
              <AppButton
                variant="secondary"
                title={suggestion.action.label}
                busy={action.busy}
                onPress={() => {
                  if (suggestion.action?.kind === 'accept') {
                    void action.run(() => preparation.respond('accept'));
                    return;
                  }
                  home.store
                    ?.chooseRestDay(todayInTz(workout.timezone), true)
                    .then(() => setRestError(null))
                    .catch((failure) =>
                      setRestError(
                        failureNotice('Could not save your rest-day choice. Try again.', failure),
                      ),
                    );
                }}
              />
            </Stack>
          )}
        </Card>
      )}
      {restError && <Notice title="Rest day" message={restError} error />}
      {preparation.parseError && <Notice title="Session" message={preparation.parseError} />}
      {action.error && <Notice title="Prescription" message={action.error} />}
      {preparation.state.error && (
        <Notice title="Prescription unavailable" message={preparation.state.error} />
      )}
      <PlanStartCard model={model} onSelect={onSelect} />
      <Picker
        label="Time limit today"
        value={String(
          budgetForPreset(
            preparation.budget,
            preparation.duration ?? readDurationPreset(prescription?.durationPreset),
          ),
        )}
        options={sessionTimeLimitOptions(preparation.budget).map((value) => ({
          value: String(value),
          label: timeLimitLabel(value),
        }))}
        disabled={action.busy}
        onChange={(value) => {
          void action.run(() => preparation.setDuration(Number(value)));
        }}
      />
      {preparation.options.fullOverride && blocked.length > 0 && (
        <Notice
          title="Some exercises remain deloaded"
          message={`${blocked.join(', ')}: full numbers were not recorded. Regenerate or keep these prescribed loads.`}
        />
      )}
    </>
  );
}
