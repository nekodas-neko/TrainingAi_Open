import { formatCount } from '@trainingai/shared/format/number';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Card, LoadingIndicator, SegmentedControl, Stack, StateCard } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import {
  AI_USAGE_WINDOWS,
  adminAiUsageSpec,
  barShares,
  estCostUsd,
  fmtUsd,
} from '../data/admin-monitoring';

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1 }}>
      <AppText variant="caption" tone="muted">
        {label.toUpperCase()}
      </AppText>
      <AppText variant="heading">{value}</AppText>
    </Card>
  );
}

export function AdminAiUsagePanel() {
  const { theme } = useTheme();
  const [hours, setHours] = useState(168);
  const usage = useWorkoutResource(adminAiUsageSpec(hours));
  const s = usage.data;
  const totalCost = s ? s.sections.reduce((a, x) => a + estCostUsd(x.inputTokens, x.outputTokens), 0) : 0;
  const bars = s ? barShares([...s.timeline].reverse().map((b) => b.calls)) : [];
  return (
    <Stack>
      <SegmentedControl<string>
        label="Window"
        appearance="tabs"
        size="xs"
        value={String(hours)}
        onChange={(v) => setHours(Number(v))}
        options={AI_USAGE_WINDOWS.map((w) => ({ label: w.label, value: String(w.hours) }))}
      />
      {!s && usage.error ? (
        <StateCard error title="Could not load" message="Couldn't load AI usage." action="Retry" onAction={usage.refresh} />
      ) : !s ? (
        <LoadingIndicator accessibilityLabel="Loading AI usage" />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Tile label="Calls" value={formatCount(s.totalCalls)} />
            <Tile label="Tokens" value={formatCount(s.totalTokens)} />
            <Tile label="Est. cost" value={fmtUsd(totalCost)} />
          </View>
          {s.totalErrors > 0 && (
            <AppText variant="caption" tone="danger">
              {formatCount(s.totalErrors)} failed call{s.totalErrors === 1 ? '' : 's'} in this window
            </AppText>
          )}
          {s.doubleTrips.length > 0 && (
            <Card tone="brand">
              <AppText variant="label">Double-trips</AppText>
              <AppText variant="caption" tone="muted">
                same call fired again within {s.windowSeconds}s
              </AppText>
              {s.doubleTrips.map((d) => (
                <AppText key={d.section} variant="caption">
                  {d.section}: {formatCount(d.redundantCalls)} redundant · {formatCount(d.affectedFingerprints)} distinct
                </AppText>
              ))}
            </Card>
          )}
          {s.timeline.length > 0 && (
            <Card>
              <AppText variant="caption" tone="muted">
                CALLS OVER TIME
              </AppText>
              <View
                accessibilityLabel={`Calls over time, ${s.timeline.length} periods`}
                style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 80 }}
              >
                {bars.map((h, i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: `${h}%`,
                      borderTopLeftRadius: 2,
                      borderTopRightRadius: 2,
                      backgroundColor: theme.colors.brand,
                    }}
                  />
                ))}
              </View>
            </Card>
          )}
          {s.sections.length === 0 ? (
            <AppText tone="muted" style={{ textAlign: 'center' }}>
              No AI calls recorded in this window.
            </AppText>
          ) : (
            <Card>
              {s.sections.map((x) => (
                <View key={x.section} style={{ gap: 2 }}>
                  <AppText variant="label">
                    {x.section}
                    {x.errors > 0 ? `  ${x.errors} err` : ''}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {formatCount(x.calls)} calls · {formatCount(x.totalTokens)} tokens ·{' '}
                    {fmtUsd(estCostUsd(x.inputTokens, x.outputTokens))} · {formatCount(x.avgLatencyMs)} ms avg
                  </AppText>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </Stack>
  );
}
