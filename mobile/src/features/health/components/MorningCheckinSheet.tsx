import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  ILLNESS_CONTEXT_OPTIONS,
  storedOrderLabels,
} from '@trainingai/shared/types/day-checkin';
import {
  AppText,
  AppButton,
  Card,
  ChipPicker,
  Sheet,
  StatusIndicator,
  Skeleton,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useHealthData } from '../data/HealthDataProvider';
import { checkinSpec, verdictSpec } from '../data/checkin';
import { verdictCopy, type StoredSleepVerdict } from '@trainingai/shared/health/sleep-verdict-copy';
import { saveSleepValue } from '@trainingai/shared/checkin/save-sleep-value';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
const draftSchema = z.object({
  correction: z.number().int().min(1).max(5).nullable(),
  acknowledged: z.boolean(),
  illness: z.enum(['sick', 'alcohol', 'poor_sleep']).nullable(),
  edited: z.boolean(),
});
const initial: z.infer<typeof draftSchema> = {
  correction: null,
  acknowledged: false,
  illness: null,
  edited: false,
};
export function MorningCheckinSheet({ onClose }: { onClose: () => void }) {
  const health = useHealthData();
  const saved = useWorkoutResource(checkinSpec(health.today));
  const announced = useWorkoutResource(verdictSpec(health.today));
  const draft = useWorkoutDraft(`morning-checkin:${health.today}`, draftSchema, initial);
  const [opened, setOpened] = useState(false);
  const [snapshot, setSnapshot] = useState<StoredSleepVerdict | null>(null);
  const contentReady = draft.ready && !saved.loading && !announced.loading;
  useEffect(() => {
    if (contentReady && !opened) {
      setSnapshot(announced.data?.verdict ?? null);
      setOpened(true);
    }
  }, [contentReady, opened]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = health.operations
    .filter((op) => op.domain === 'day_checkins' && op.date === health.today)
    .at(-1);
  const row = pending?.payload ?? health.checkins[health.today] ?? saved.data;
  useEffect(() => {
    if (!draft.ready || !row) {
      return;
    }
    draft.setValue((value) =>
      value.edited
        ? value
        : {
            ...value,
            correction:
              row.sleepQualityFeelTouched && typeof row.sleepQualityFeel === 'number'
                ? row.sleepQualityFeel
                : null,
            illness: (row.illnessContext as typeof value.illness) ?? null,
          },
    );
  }, [draft.ready, row]);
  const localNight = health.sleep.find(
    (night) => night.date === health.today && night.localOnly,
  );
  const verdict = localNight ? null : opened ? snapshot : (announced.data?.verdict ?? null);
  const copy = verdict ? verdictCopy(verdict) : null;
  async function save() {
    if (!health.store || saving || !draft.ready) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sleep = saveSleepValue(draft.value.correction, verdict);
      await health.store.saveCheckin(
        health.today,
        {
          phase: 'morning',
          perceivedRecovery: null,
          perceivedRecoveryTouched: false,
          sleepQualityFeel: sleep.value,
          sleepQualityFeelTouched: sleep.touched,
          illnessContext: draft.value.illness,
          vsNormal: null,
          motivation: null,
          restingSoreness: null,
          wakeMood: null,
          soreMuscles: [],
          journal: null,
        },
        verdict
          ? draft.value.correction != null
            ? 'corrected'
            : draft.value.acknowledged
              ? 'acknowledged'
              : undefined
          : undefined,
      );
      draft.setValue((value) => ({ ...value, edited: false }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your check-in.');
    } finally {
      setSaving(false);
    }
  }
  const update = (patch: Partial<typeof initial>) =>
    draft.setValue((value) => ({ ...value, ...patch, edited: true }));
  return (
    <Sheet
      visible
      fullHeight
      title="Morning check-in"
      onClose={onClose}
      actions={
        <StatusIndicator
          label="Morning check-in"
          busy={!draft.ready || saved.loading || announced.loading}
          error={error ?? draft.error ?? (saved.data === null ? saved.error : null)}
          onRetry={() => {
            saved.refresh();
            announced.refresh();
          }}
        />
      }
      footer={
        <AppButton
          title="Save"
          busy={saving}
          disabled={!contentReady || !health.ready || !health.store}
          onPress={() => void save()}
        />
      }
    >
      {opened || contentReady ? (
        <>
          {(copy || localNight) && (
            <Card>
              <AppText variant="caption">
                {copy?.line ??
                  `${formatHoursMinutes((localNight?.durationHours ?? 0) * 60)} sleep · Apple Health`}
              </AppText>
              <ChipPicker
                label={
                  draft.value.correction == null
                    ? copy
                      ? 'Not right? Set it yourself'
                      : 'How did you sleep?'
                    : 'You set this'
                }
                value={draft.value.correction}
                options={storedOrderLabels('sleepQualityFeel').map((label, i) => ({
                  label,
                  value: i + 1,
                }))}
                disabled={!draft.ready}
                onChange={(correction) => update({ correction, acknowledged: false })}
              />
              {copy?.prominent && draft.value.correction == null && (
                <AppButton
                  title={draft.value.acknowledged ? 'Marked as right' : 'That’s right'}
                  variant="ghost"
                  onPress={() => update({ acknowledged: !draft.value.acknowledged })}
                />
              )}
            </Card>
          )}
          <ChipPicker
            label="Anything affecting today?"
            value={draft.value.illness}
            options={ILLNESS_CONTEXT_OPTIONS}
            disabled={!draft.ready}
            onChange={(illness) => update({ illness })}
          />
        </>
      ) : (
        <>
          <Skeleton style={{ height: 220 }} />
          <Skeleton style={{ height: 100 }} />
        </>
      )}
    </Sheet>
  );
}
