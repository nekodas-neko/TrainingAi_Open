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
  Notice,
  Picker,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { useWorkoutAction } from '../data/useWorkoutAction';
import { useSessionPreparation } from '../data/useSessionPreparation';

export function PrescriptionControls({
  preparation,
}: {
  preparation: ReturnType<typeof useSessionPreparation>;
}) {
  const action = preparation.action;
  const [confirm, setConfirm] = useState<string | null>(null);
  const state = preparation.state.data?.state;
  const prescription = state?.prescription;
  const blocked =
    preparation.session?.exercises
      .filter((exercise) => exercise.deloaded && !exercise.preDeloadStyle?.length)
      .map((exercise) => exercise.name) ?? [];
  return (
    <>
      <AppText variant="eyebrow" tone="muted">
        Intensity today
      </AppText>
      <Stack direction="row">
        <AppButton
          title={`Full${prescription?.deload ? ' · Override' : ' · As prescribed'}`}
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
          title={`Deload${prescription?.deload ? ' · As prescribed' : ' · Lighter loads'}`}
          variant={preparation.deload ? 'primary' : 'surface'}
          onPress={() => preparation.chooseDeload(true)}
          disabled={action.busy}
          style={{ flex: 1 }}
        />
      </Stack>
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
            <AppText variant="heading">
              {prescription.deload
                ? 'Deload session'
                : prescription.phase[0]?.toUpperCase() + prescription.phase.slice(1)}
            </AppText>
            <Badge label={(state?.prescriptionStatus ?? '').replace(/_/g, ' ')} />
          </Stack>
          <AppText variant="caption" tone="muted">
            {prescription.reasoning}
          </AppText>
          <AppText variant="caption">
            Working time · ~
            {Math.round(
              preparation.options.fullOverride && prescription.fullSession
                ? prescription.fullSession.estimatedSessionDurationMin
                : prescription.estimatedSessionDurationMin,
            )}{' '}
            min
          </AppText>
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
              title={`Move to ${prescription.phase}`}
              variant="secondary"
              onPress={() => setConfirm(prescription.phase)}
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
              (value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }),
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
            title={`Move to ${confirm}?`}
            message="This changes the session's training phase and regenerates its prescription."
            confirmLabel="Change phase"
            cancelLabel="Cancel"
            busy={action.busy}
            onConfirm={() => {
              void action
                .run(() =>
                  preparation.transition(
                    confirm,
                    prescription?.phase !== confirm ||
                      !['transition_recommended', 'deload_recommended'].includes(
                        prescription?.phaseAction ?? '',
                      ),
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
