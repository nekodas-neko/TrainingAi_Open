import { capitalize } from '@trainingai/shared/format/capitalize';
import { useState } from 'react';
import {
  sessionTimeLimitOptions,
  budgetForPreset,
  timeLimitLabel,
  readDurationPreset,
} from '@trainingai/shared/workout/duration-model';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  Icon,
  Notice,
  Picker,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { useSessionPreparation } from '../data/useSessionPreparation';
import { intensityToggleModel } from '../data/intensity-toggle';
import { useWorkoutContext } from '../WorkoutProvider';
import { dailyCheckStrip } from '../../home/data/recommendation-reasons';
import { DeloadStrip } from '../../home/components/DeloadStrip';
import { useTheme } from '../../../shared/theme/ThemeProvider';

export function PrescriptionControls({
  preparation,
}: {
  preparation: ReturnType<typeof useSessionPreparation>;
}) {
  const action = preparation.action;
  const [confirm, setConfirm] = useState<string | null>(null);
  const state = preparation.prescribedState;
  const prescription = state?.prescription;
  const { theme } = useTheme();
  // Today's rest-or-lighter call is the app's daily check, the one Home's strip shows.
  const daily = useWorkoutContext().catalog?.recommendation;
  const strip = dailyCheckStrip(daily);
  const toggle = intensityToggleModel({
    prescription,
    exercises: preparation.asSent,
    deloadChosen: preparation.deload,
    suggestedToday: !!daily?.deloadOrRestRecommended,
  });
  const blocked =
    preparation.session?.exercises
      .filter((exercise) => exercise.deloaded && !exercise.preDeloadStyle?.length)
      .map((exercise) => exercise.name) ?? [];
  return (
    <>
      {strip && <DeloadStrip strip={strip} />}
      <AppText variant="eyebrow" tone="muted">
        Intensity today
      </AppText>
      <Stack direction="row">
        <AppButton
          title={toggle.fullLabel}
          variant={!preparation.deload ? 'primary' : 'surface'}
          busy={action.busy}
          onPress={() => {
            preparation.chooseDeload(false);
            if (blocked.length) {
              void action.run(preparation.regenerate);
            }
          }}
          style={{ flex: 1 }}
        />
        <AppButton
          title={toggle.deloadLabel}
          variant={preparation.deload ? 'primary' : 'surface'}
          onPress={() => preparation.chooseDeload(true)}
          disabled={action.busy}
          style={{ flex: 1 }}
        />
      </Stack>
      {toggle.difference && (
        // #3330: what the other side changes, stated before the flip.
        <Stack
          direction="row"
          align="flex-start"
          gap="sm"
          style={{
            borderRadius: theme.radii.control,
            backgroundColor: theme.colors.raised,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
          }}
        >
          <Icon name="swap" size={theme.sizes.iconSmall} tone="brand" />
          <AppText variant="caption" style={{ flex: 1 }}>
            {toggle.difference}
          </AppText>
        </Stack>
      )}
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
      {preparation.parseError && <Notice title="Session" message={preparation.parseError} />}
      {action.error && <Notice title="Prescription" message={action.error} />}
      {preparation.state.error && (
        <Notice title="Prescription unavailable" message={preparation.state.error} />
      )}
      {!prescription ? (
        <Card tone="brand">
          <AppText variant="heading">
            {preparation.session?.isBaseline ? 'AMRAP baseline' : 'Your prescription'}
          </AppText>
          <AppText variant="caption" tone="muted">
            {preparation.session?.isBaseline
              ? 'Complete the baseline exercises to establish your working weights.'
              : 'Generate the current session prescription.'}
          </AppText>
          {!preparation.session?.isBaseline && (
            <AppButton
              title="Generate prescription"
              busy={action.busy}
              onPress={() => {
                void action.run(preparation.regenerate);
              }}
            />
          )}
        </Card>
      ) : (
        <Card tone="brand">
          <Stack direction="row" justify="space-between">
            <AppText variant="heading">{toggle.card?.heading}</AppText>
            <Badge label={(state?.prescriptionStatus ?? '').replace(/_/g, ' ')} />
          </Stack>
          <AppText variant="caption" tone="muted">
            {toggle.card?.reason}
          </AppText>
          <AppText variant="caption">Working time · ~{toggle.card?.minutes} min</AppText>
          {state?.prescriptionStatus === 'pending' && (
            <Stack direction="row">
              <AppButton
                title="Accept"
                busy={action.busy}
                onPress={() => {
                  void action.run(() => preparation.respond('accept'));
                }}
              />
              <AppButton
                title="Dismiss"
                variant="surface"
                disabled={action.busy}
                onPress={() => {
                  void action.run(() => preparation.respond('dismiss'));
                }}
              />
            </Stack>
          )}
          {['transition_recommended', 'deload_recommended'].includes(prescription.phaseAction) && (
            <AppButton
              title={
                prescription.phaseAction === 'deload_recommended' || prescription.typeOnlyMove
                  ? `Move to ${prescription.phase}`
                  : `Move the program to ${prescription.phase}`
              }
              variant="secondary"
              onPress={() => {
                // #3799: a one-day deload offer is taken for this session only; the phase stays.
                if (prescription.phaseAction === 'deload_recommended') {
                  void action.run(() => preparation.respond('accept'));
                } else {
                  setConfirm(prescription.phase);
                }
              }}
            />
          )}
          <AppButton
            title="Regenerate"
            variant="ghost"
            busy={action.busy}
            onPress={() => {
              void action.run(preparation.regenerate);
            }}
          />
          <Picker
            label="Advance phase"
            value=""
            options={['baseline', 'accumulation', 'intensification', 'realisation', 'deload'].map(
              (value) => ({ value, label: capitalize(value) }),
            )}
            disabled={action.busy}
            onChange={setConfirm}
          />
        </Card>
      )}
      {preparation.options.fullOverride && blocked.length > 0 && (
        <Notice
          title="Some exercises remain deloaded"
          message={`${blocked.join(', ')}: full numbers were not recorded. Regenerate or keep these prescribed loads.`}
        />
      )}
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
                .run(() =>
                  preparation.transition(
                    confirm,
                    // Only the recommended transition goes unforced. Everything else here is
                    // the lifter's own pick from the phase list, which moves the phase even over a
                    // one-day deload offer (#3799).
                    prescription?.phase !== confirm ||
                      prescription?.phaseAction !== 'transition_recommended',
                  ),
                )
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
