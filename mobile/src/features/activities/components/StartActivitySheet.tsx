import { useEffect, useState } from 'react';
import {
  AppButton,
  AppText,
  Card,
  ChoiceTiles,
  HubCard,
  Notice,
  Sheet,
  Stack,
} from '../../../shared/ui';
import {
  START_ROOT_ROWS,
  TREADMILL_KINDS,
  TREADMILL_LOG_MINUTES,
  WALK_RUN_ROWS,
  somethingElseTypes,
  startStepBack,
  startStepTitle,
  type StartStep,
  type TreadmillKind,
  type WalkRunKind,
} from '../data/cardio-start';
import type { ActivityType } from '../data/models';
import { ActivityTypeTiles } from './ActivityPicker';

/**
 * The Cardio Hub's one way to start an activity (#4100): Walk or run, or Something else. Each
 * choice is handed to the screen, which owns the single start, the open-activity answer and the
 * wait for this sheet to close before it navigates (#4099).
 */
export function StartActivitySheet({
  visible,
  initialStep = 'root',
  busy,
  error,
  onClose,
  onDismiss,
  onKind,
  onTreadmillNow,
  onTreadmillLog,
  onType,
}: {
  visible: boolean;
  /** The step a fresh open starts at. */
  initialStep?: StartStep;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onDismiss: () => void;
  onKind: (kind: Exclude<WalkRunKind, 'treadmill'>) => void;
  onTreadmillNow: (kind: TreadmillKind) => void;
  onTreadmillLog: (kind: TreadmillKind, minutes: number) => void;
  onType: (type: ActivityType) => void;
}) {
  const [step, setStep] = useState<StartStep>('root');
  const [kind, setKind] = useState<TreadmillKind>('walk');
  // A fresh open starts at `initialStep`.
  useEffect(() => {
    if (visible) setStep(initialStep);
  }, [visible, initialStep]);
  const back = startStepBack(step);
  return (
    <Sheet
      visible={visible}
      title={startStepTitle(step)}
      onClose={onClose}
      onBack={back ? () => setStep(back) : undefined}
      onDismiss={onDismiss}
      footer={
        step === 'treadmill' ? (
          <AppButton
            title="Start now"
            disabled={busy}
            onPress={() => onTreadmillNow(kind)}
          />
        ) : undefined
      }
    >
      {error && <Notice error title="Could not start the activity" message={error} />}
      {back && (
        <AppButton
          title="Back"
          variant="surface"
          icon="back"
          onPress={() => setStep(back)}
        />
      )}
      {step === 'root' &&
        START_ROOT_ROWS.map((row) => (
          <HubCard
            key={row.key}
            title={row.title}
            subtitle={row.caption}
            icon={row.key === 'else' ? 'activity' : 'legs'}
            onPress={() => setStep(row.key)}
          />
        ))}
      {step === 'walk-run' &&
        WALK_RUN_ROWS.map((row) => (
          <HubCard
            key={row.key}
            title={row.title}
            subtitle={row.caption}
            icon="legs"
            onPress={() => (row.key === 'treadmill' ? setStep('treadmill') : onKind(row.key))}
          />
        ))}
      {step === 'treadmill' && (
        <>
          <ChoiceTiles
            label="What are you doing?"
            value={kind}
            options={TREADMILL_KINDS}
            onChange={setKind}
            disabled={busy}
          />
          <Card>
            <AppText variant="label">Already done? Log it</AppText>
            <Stack direction="row">
              {TREADMILL_LOG_MINUTES.map((minutes) => (
                <AppButton
                  key={minutes}
                  title={`${minutes} min`}
                  variant="surface"
                  disabled={busy}
                  style={{ flex: 1 }}
                  onPress={() => onTreadmillLog(kind, minutes)}
                />
              ))}
            </Stack>
          </Card>
        </>
      )}
      {step === 'else' && (
        <ActivityTypeTiles
          visible={visible}
          busy={busy}
          filter={somethingElseTypes}
          onSelect={onType}
        />
      )}
    </Sheet>
  );
}
