import { useState } from 'react';
import { View } from 'react-native';
import { AppButton, AppText, Card, Notice, Stack, TextField } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { failureNotice } from '../../../core/reporting/index.ts';
import {
  applyConfirmMessage,
  isDateInput,
  toggleIn,
  unitFixResultSchema,
  type UnitFixResult,
} from '../data/admin-content';
import { ConfirmSheet } from './ConfirmSheet';

const fmt = (n: number | null) => (n === null ? '—' : String(n));

/** Converts lbs-logged-as-kg sessions. Preview first; the write sits behind a confirm that says to sync the phone first. */
export function AdminUnitFixPanel({ exerciseNames }: { exerciseNames: readonly string[] }) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const [selected, setSelected] = useState<string[]>([]);
  const [beforeDate, setBeforeDate] = useState('');
  const [result, setResult] = useState<UnitFixResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = selected.length > 0 && isDateInput(beforeDate);

  async function run(apply: boolean) {
    if (!resources || busy || !ready) return;
    setBusy(apply ? 'apply' : 'preview');
    setError(null);
    try {
      const response = await resources.write('POST', '/api/admin/fix-exercise-units', {
        exerciseNames: selected,
        beforeDate,
        apply,
      });
      setResult(unitFixResultSchema.parse(response));
      setApplied(apply);
    } catch (failure) {
      setError(failureNotice(apply ? 'Failed to apply fix' : 'Failed to compute preview', failure));
    } finally {
      setBusy(null);
    }
  }
  function reset() {
    setResult(null);
    setApplied(false);
  }

  return (
    <Stack>
      <AppText variant="caption" tone="muted">
        Select the exercise(s) that were logged in lbs but recorded as kg, and the date before which this
        applies. Set weights, estimated 1RM, target 80%, volume and the personal record will be
        recalculated for affected sessions.
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {exerciseNames.map((name) => (
          <AppButton
            key={name}
            title={name}
            variant={selected.includes(name) ? 'primary' : 'secondary'}
            onPress={() => {
              reset();
              setSelected((s) => toggleIn(s, name));
            }}
          />
        ))}
        {exerciseNames.length === 0 && (
          <AppText variant="caption" tone="muted">
            No logged exercises found.
          </AppText>
        )}
      </View>
      <TextField
        label="Convert sessions logged before (YYYY-MM-DD)"
        value={beforeDate}
        placeholder="2026-01-31"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        onChangeText={(v) => {
          reset();
          setBeforeDate(v.trim());
        }}
      />
      <AppButton title="Preview" busy={busy === 'preview'} disabled={!ready || !!busy} onPress={() => void run(false)} />
      {error && <Notice title="Could not do that" message={error} error />}
      {result && (
        <Card>
          {result.logs.length === 0 ? (
            <AppText tone="muted">
              {result.alreadyConverted
                ? `Nothing to convert: ${result.alreadyConverted} session(s) before ${beforeDate} were already converted and are left alone.`
                : `No sessions found for the selected exercise(s) before ${beforeDate}.`}
            </AppText>
          ) : (
            <>
              {!!result.alreadyConverted && (
                <AppText variant="caption" tone="muted">
                  {result.alreadyConverted} more session(s) were already converted and are left alone.
                </AppText>
              )}
              {result.exercises.map((ex) => (
                <AppText key={ex.exerciseName} variant="caption">
                  {ex.exerciseName} PR: {fmt(ex.oldPersonalRecord)}kg → {fmt(ex.newPersonalRecord)}kg
                </AppText>
              ))}
              {result.logs.map((log) => (
                <View key={log.exerciseLogId} style={{ gap: 2 }}>
                  <AppText variant="label">
                    {log.exerciseName} — {new Date(log.loggedAt).toLocaleDateString('en-AU')}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    Sets: {log.sets.map((s) => `${s.oldWeightKg}→${s.newWeightKg}kg×${s.reps}`).join(', ')}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    1RM: {fmt(log.oldEstimated1rm)} → {fmt(log.newEstimated1rm)}kg · Volume: {fmt(log.oldVolume)} → {fmt(log.newVolume)}kg
                  </AppText>
                </View>
              ))}
              {applied ? (
                <AppText tone="brand">Applied — {result.logs.length} session(s) converted.</AppText>
              ) : (
                <AppButton
                  title={`Apply — converts ${result.logs.length} session(s)`}
                  variant="danger"
                  busy={busy === 'apply'}
                  disabled={!!busy}
                  onPress={() => setConfirming(true)}
                />
              )}
            </>
          )}
        </Card>
      )}
      {confirming && result && (
        <ConfirmSheet
          title="Convert these weights to kg?"
          message={applyConfirmMessage(result.logs.length, selected, beforeDate)}
          confirmLabel="Convert"
          onClose={() => setConfirming(false)}
          onConfirm={() => void run(true)}
        />
      )}
    </Stack>
  );
}
