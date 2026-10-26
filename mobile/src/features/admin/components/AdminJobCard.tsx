import { useState } from 'react';
import { View } from 'react-native';
import { AppButton, AppText, Badge, Card, Notice, Stack, SwitchRow, TextField } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { failureNotice } from '../../../core/reporting/index.ts';
import {
  WRITE_PHRASE,
  canWrite,
  jobFailure,
  jobQuery,
  rangeProblem,
  remainingOf,
  summaryRows,
  type AdminJob,
  type JobParams,
  type JobReport,
} from '../data/admin-jobs';

/** One data job: dry run first, then a write that needs the snapshot ticked and the word typed. */
export function AdminJobCard({ job }: { job: AdminJob }) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const [params, setParams] = useState<JobParams>({ from: '', to: '' });
  const [dry, setDry] = useState<JobReport | null>(null);
  const [dryParams, setDryParams] = useState<JobParams | null>(null);
  const [written, setWritten] = useState<JobReport | null>(null);
  const [snapshot, setSnapshot] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState<'dry' | 'write' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problem = rangeProblem(job, params);

  function editParams(next: JobParams) {
    // A dry run only vouches for the dates it ran with.
    setParams(next);
    setDry(null);
    setDryParams(null);
    setWritten(null);
    setTyped('');
  }
  async function run(write: boolean) {
    if (!resources || busy || problem) return;
    if (write && !canWrite({ dry, dryParams, params, snapshot, typed })) return;
    setBusy(write ? 'write' : 'dry');
    setError(null);
    try {
      const report = (await resources.write(
        'POST',
        job.path,
        undefined,
        [],
        jobQuery(job, params, write),
      )) as JobReport;
      if (write) {
        setWritten(report);
        // The dry run is spent: another write needs a fresh one.
        setDry(null);
        setDryParams(null);
        setTyped('');
      } else {
        setDry(report);
        setDryParams(params);
        setWritten(null);
      }
    } catch (failure) {
      setError(failureNotice(jobFailure(failure), failure));
    } finally {
      setBusy(null);
    }
  }

  const rows = summaryRows(written ?? dry);
  const remaining = remainingOf(written);
  const unlocked = canWrite({ dry, dryParams, params, snapshot, typed });
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        <AppText variant="heading" style={{ flexShrink: 1 }}>
          {job.title}
        </AppText>
        <Badge label={job.issue} />
        {job.movesPastScores && <Badge label="Moves past scores" tone="heart" />}
      </View>
      <AppText variant="caption" tone="muted">
        {job.what}
      </AppText>
      <AppText variant="caption" tone="muted">
        {job.expect}
      </AppText>
      {job.range !== 'none' && (
        <Stack gap="sm">
          <TextField
            label={job.range === 'optional' ? 'From (YYYY-MM-DD, optional)' : 'From (YYYY-MM-DD)'}
            value={params.from}
            placeholder="2026-09-01"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            onChangeText={(from) => editParams({ ...params, from: from.trim() })}
          />
          <TextField
            label={job.range === 'optional' ? 'To (YYYY-MM-DD, optional)' : 'To (YYYY-MM-DD)'}
            value={params.to}
            placeholder="2026-09-30"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            onChangeText={(to) => editParams({ ...params, to: to.trim() })}
          />
          {problem && (
            <AppText variant="caption" tone="danger">
              {problem}
            </AppText>
          )}
        </Stack>
      )}
      <AppButton
        title="Dry run"
        variant="surface"
        busy={busy === 'dry'}
        disabled={!!busy || !!problem}
        onPress={() => void run(false)}
      />
      {error && <Notice title="Could not run" message={error} error />}
      {rows.length > 0 && (
        <Card tone={written ? 'brand' : 'neutral'}>
          <AppText variant="label">{written ? 'Written' : 'Dry run: nothing was written'}</AppText>
          {rows.map((r) => (
            <AppText key={r.label} variant="caption">
              {r.label}: {r.value}
            </AppText>
          ))}
          {remaining > 0 && (
            <AppText variant="caption" tone="danger">
              {remaining} left. Do a fresh dry run, then write again.
            </AppText>
          )}
        </Card>
      )}
      {dry?.dryRun === true && (
        <Stack gap="sm">
          <AppText variant="label">To write for real</AppText>
          <SwitchRow
            label="A verified snapshot exists (scripts/local-db/snapshot.js)"
            value={snapshot}
            onValueChange={setSnapshot}
          />
          <TextField
            label={`Type ${WRITE_PHRASE} to confirm`}
            value={typed}
            placeholder={WRITE_PHRASE}
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={setTyped}
          />
          <AppButton
            title="Write for real"
            variant="danger"
            busy={busy === 'write'}
            disabled={!unlocked || !!busy}
            onPress={() => void run(true)}
          />
        </Stack>
      )}
    </Card>
  );
}
