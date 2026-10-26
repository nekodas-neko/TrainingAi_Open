import { useState } from 'react';
import { AppText, Card, LoadingIndicator, SegmentedControl, Stack, StateCard } from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { APP_LOAD_DAYS, adminAppLoadSpec, fmtInt, splitLoadRoutes } from '../data/admin-monitoring';

/** p50 / p95 per route, cold and warm kept apart. The route has no screen in the current app, so this is new. */
export function AdminAppLoadPanel() {
  const [days, setDays] = useState(7);
  const report = useWorkoutResource(adminAppLoadSpec(days));
  const r = report.data;
  const { cold, warm } = r ? splitLoadRoutes(r.routes) : { cold: [], warm: [] };
  const group = (title: string, samples: number, rows: typeof cold) => (
    <Card>
      <AppText variant="heading">{title}</AppText>
      <AppText variant="caption" tone="muted">
        {fmtInt(samples)} samples
      </AppText>
      {rows.length === 0 ? (
        <AppText variant="caption" tone="muted">
          None recorded.
        </AppText>
      ) : (
        rows.map((x) => (
          <Stack gap="xs" key={`${x.route}:${x.cold}`}>
            <AppText variant="label" numberOfLines={1}>
              {x.route}
            </AppText>
            <AppText variant="caption" tone="muted">
              p50 {fmtInt(x.p50Ms)} ms · p95 {fmtInt(x.p95Ms)} ms · worst {fmtInt(x.worstMs)} ms ·{' '}
              {fmtInt(x.samples)} loads
            </AppText>
          </Stack>
        ))
      )}
    </Card>
  );
  return (
    <Stack>
      <SegmentedControl<string>
        label="Days"
        appearance="tabs"
        size="xs"
        value={String(days)}
        onChange={(v) => setDays(Number(v))}
        options={APP_LOAD_DAYS.map((d) => ({ label: `${d}d`, value: String(d) }))}
      />
      {!r && report.error ? (
        <StateCard error title="Could not load" message="Couldn't load the app-load report." action="Retry" onAction={report.refresh} />
      ) : !r ? (
        <LoadingIndicator accessibilityLabel="Loading app load" />
      ) : (
        <>
          {group('Cold starts', r.coldSamples, cold)}
          {group('Warm loads', r.warmSamples, warm)}
        </>
      )}
    </Stack>
  );
}
