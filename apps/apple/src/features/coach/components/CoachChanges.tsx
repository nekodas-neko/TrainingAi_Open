import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { z } from 'zod';
import { AppButton, AppText, Card, NumericStepper, Stack, SwitchRow } from '../../../shared/ui';
import { GOAL_BOUNDS } from '@trainingai/shared/validation/goal-bounds';
import { useCoach } from '../CoachProvider';
import { coachError, type previewSchema } from '../data/models';
import {
  DOMAIN_TIER,
  FIELD_LABEL,
  FIELD_UNIT,
  type CoachPatch,
  type PatchChange,
} from '../data/patch';
import type { CoachWidget as Widget, WidgetResult } from '../data/widgets';
export function patchValue(value: unknown, field: PatchChange['field']) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return `${typeof value === 'number' ? value.toLocaleString() : value}${FIELD_UNIT[field] ?? ''}`;
}
export function ChangeRows({ patch }: { patch: CoachPatch }) {
  return (
    <Stack>
      {patch.changes.map((change) => (
        <Stack key={change.id} gap="xs">
          <AppText variant="label">{FIELD_LABEL[change.field]}</AppText>
          <AppText variant="caption" tone="muted">
            {patchValue(change.from, change.field)} → {patchValue(change.to, change.field)}
          </AppText>
        </Stack>
      ))}
    </Stack>
  );
}
export function Consequences({ data }: { data: z.infer<typeof previewSchema> | null }) {
  return (
    <Stack>
      {data?.consequences.map((c, i) => (
        <AppText key={i} variant="caption" tone="muted">
          {c.kind === 'warn' ? '⚠ ' : c.kind === 'good' ? '✓ ' : ''}
          {c.text}
        </AppText>
      ))}
      {!!data?.drift.length && (
        <AppText variant="caption" tone="danger">
          This suggestion is out of date — {data.drift[0].field} is now {data.drift[0].actual}.
          Ask Coach for a fresh one.
        </AppText>
      )}
    </Stack>
  );
}
export function ChangeCard({
  args,
  onResult,
}: {
  args: Extract<Widget, { kind: 'number_dial' | 'change_preview' }>;
  onResult?: (result: WidgetResult) => void;
}) {
  const coach = useCoach();
  const [accepted, setAccepted] = useState(args.patch.changes.map((c) => c.id));
  const [value, setValue] = useState(Number(args.patch.changes[0].to));
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const guard = useRef(false),
    live = useRef(!!onResult);
  live.current = !!onResult;
  useEffect(() => {
    if (!coach || !onResult) return;
    let current = true;
    void coach.actions
      .preview(args.patch)
      .then((data) => {
        if (current) {
          setPreview(data);
          setError(null);
        }
      })
      .catch(() => {
        if (current) setError('Could not check this suggestion. Retry before applying it.');
      });
    return () => {
      current = false;
    };
  }, [coach, args.patch, !!onResult, retry]);
  const change = args.patch.changes[0],
    step =
      change.field === 'stepsGoal'
        ? 500
        : change.field === 'waterGoalMl'
          ? 250
          : ['calories', 'calorieGoal'].includes(change.field)
            ? 50
            : 5;
  const dial =
    args.kind === 'number_dial' &&
    args.patch.changes.length === 1 &&
    DOMAIN_TIER[args.patch.domain] === 1 &&
    typeof change.to === 'number';
  async function apply() {
    if (!coach || guard.current || !live.current || !preview || preview.drift.length) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      const patch = dial
        ? ({ ...args.patch, changes: [{ ...change, to: value }] } as CoachPatch)
        : args.patch;
      const result = await coach.actions.apply(patch, dial ? [change.id] : accepted);
      if (result) onResult?.({ status: 'applied', summary: result.summary });
    } catch (cause) {
      setError(coachError(cause, 'apply this change'));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <Card tone="sleep" style={{ opacity: onResult ? 1 : 0.6 }}>
      <AppText variant="label">{args.title}</AppText>
      {dial ? (
        <Stack>
          <NumericStepper
            label={FIELD_LABEL[change.field]}
            value={String(value)}
            onChange={(v) => setValue(v.trim() ? Number(v) : NaN)}
            step={step}
            min={0}
            max={GOAL_BOUNDS[change.field as keyof typeof GOAL_BOUNDS]?.max ?? 0}
            disabled={!onResult || busy}
          />
          <AppText variant="caption" tone="muted">
            Current: {patchValue(change.from, change.field)} · Proposed:{' '}
            {patchValue(value, change.field)}
          </AppText>
        </Stack>
      ) : (
        args.patch.changes.map((change) => (
          <Stack key={change.id} gap="xs">
            <SwitchRow
              label={FIELD_LABEL[change.field]}
              value={accepted.includes(change.id)}
              disabled={!onResult || busy || !!preview?.drift.length}
              onValueChange={(yes) =>
                setAccepted((ids) =>
                  yes ? [...ids, change.id] : ids.filter((id) => id !== change.id),
                )
              }
            />
            <AppText variant="caption" tone="muted">
              {patchValue(change.from, change.field)} → {patchValue(change.to, change.field)}
            </AppText>
          </Stack>
        ))
      )}
      <View style={{ minHeight: 44 }}>
        <Consequences data={preview} />
      </View>
      {error && (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      )}
      {!preview && onResult && (
        <AppButton
          title={error ? 'Retry preview' : 'Checking suggestion…'}
          variant="ghost"
          disabled={!error}
          onPress={() => setRetry((n) => n + 1)}
        />
      )}
      {onResult && (
        <Stack direction="row">
          <AppButton
            title="Cancel"
            variant="surface"
            disabled={busy}
            style={{ flex: 1 }}
            onPress={() => onResult({ status: 'cancelled' })}
          />
          <AppButton
            title={
              dial
                ? 'Set'
                : accepted.length === args.patch.changes.length
                  ? 'Apply'
                  : `Apply ${accepted.length}`
            }
            busy={busy}
            style={{ flex: 1.5 }}
            disabled={
              !preview ||
              !!preview.drift.length ||
              !accepted.length ||
              (dial && (value === change.from || !Number.isFinite(value)))
            }
            onPress={() => {
              void apply();
            }}
          />
        </Stack>
      )}
    </Card>
  );
}
