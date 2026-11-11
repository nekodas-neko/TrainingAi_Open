import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppButton, AppText, Card, Icon, LineChart, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { rateDisplay } from '../../health/data/hr-recovery-view';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { exerciseHrTrendSpec } from '../data/models';
import { exerciseHrView } from '../data/exercise-hr-view';

// The current app's Heart & Recovery card (components/workout/exercise-hr-trend-card.tsx): peak
// heart rate and how far it falls during the rest, over time and by %1RM. Like that card it draws
// nothing until the exercise has at least one set with heart-rate cover.
//
// The recovery figures are cardiovascular only and say nothing about CNS or muscular readiness;
// the closing line is part of the card, not decoration.
export function ExerciseHrTrendCard({ name }: { name: string }) {
  const { theme } = useTheme();
  const state = useWorkoutResource(exerciseHrTrendSpec(name));
  const cyan = theme.training.activity;
  const amber = theme.status.warning;
  const change = (value: number | null) => {
    const rate = rateDisplay(value);
    return {
      text: rate.text,
      color: rate.direction ? (rate.direction === 'down' ? cyan : amber) : undefined,
    };
  };
  if (state.data === null) {
    // A failed read must not look like "no heart rate recorded for this exercise".
    return state.error && !state.loading ? (
      <Card>
        <Stack direction="row" gap="sm" align="center">
          <Icon name="alert" tone="muted" size={theme.sizes.iconSmall} />
          <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
            Couldn’t load heart-rate history.
          </AppText>
        </Stack>
        <AppButton title="Retry" variant="ghost" onPress={state.refresh} />
      </Card>
    ) : null;
  }
  const view = exerciseHrView(state.data);
  if (!view) return null;
  const { latest } = view;
  const recovery = change(latest?.avgDrop60 ?? null);
  return (
    <Card>
      <Stack direction="row" gap="xs" align="center">
        <Icon name="cardio" tone="muted" size={12} />
        <AppText variant="eyebrow" tone="muted">
          Heart &amp; Recovery
        </AppText>
      </Stack>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Stat
          value={latest?.avgPeakBpm == null ? '—' : String(latest.avgPeakBpm)}
          unit="bpm"
          label="Peak HR / set"
          color={theme.colors.brandText}
        />
        <Stat
          value={recovery.text}
          unit="bpm"
          label="HR settled in 60s rest"
          color={recovery.color}
        />
        {latest?.avgPctHrrAtRestEnd != null && (
          <Stat
            value={String(latest.avgPctHrrAtRestEnd)}
            unit="%"
            label="Recovered by next set"
          />
        )}
      </View>
      <AppText variant="axisTick" tone="muted" style={{ textAlign: 'center' }}>
        <AppText variant="axisTick" style={{ color: cyan }}>
          ↓
        </AppText>{' '}
        HR fell during rest (recovering) ·{' '}
        <AppText variant="axisTick" style={{ color: amber }}>
          ↑
        </AppText>{' '}
        still climbing
      </AppText>
      {view.curve && (
        <Box>
          <AppText variant="axisTick" tone="muted">
            Recovery curve · HR drop into rest
          </AppText>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            {view.curve.map(([label, value]) => {
              const point = change(value);
              return (
                <View
                  key={label}
                  accessible
                  accessibilityLabel={`${label} into rest, ${point.text}${value == null ? '' : ' bpm'}`}
                  style={{ alignItems: 'center' }}
                >
                  <AppText variant="label" style={point.color ? { color: point.color } : undefined}>
                    {point.text}
                  </AppText>
                  <AppText variant="axisTick" tone="muted">
                    {label}
                  </AppText>
                </View>
              );
            })}
          </View>
        </Box>
      )}
      {(view.peakSeries || view.dropSeries) && (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {view.peakSeries && (
            <Trend
              label="Peak HR each session"
              values={view.peakSeries}
              color={theme.colors.brand}
            />
          )}
          {view.dropSeries && (
            <Trend label="HR settled in 60s rest" values={view.dropSeries} color={cyan} />
          )}
        </View>
      )}
      {view.byIntensity.length > 0 && (
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.control,
            overflow: 'hidden',
          }}
        >
          <Row>
            {['%1RM', 'Settled/60s', 'Peak HR'].map((heading, index) => (
              <Cell key={heading} first={index === 0}>
                <AppText variant="axisTick" tone="muted">
                  {heading}
                </AppText>
              </Cell>
            ))}
          </Row>
          {view.byIntensity.map((band, index) => {
            const settled = change(band.avgDrop60);
            return (
              <Row
                key={band.label}
                last={index === view.byIntensity.length - 1}
                label={`${band.label} percent of 1RM, settled ${settled.text} in 60 seconds over ${band.n} sets, peak ${band.avgPeakBpm ?? 'not recorded'}${band.avgPeakBpm == null ? '' : ' bpm'}`}
              >
                <Cell first>
                  <AppText variant="caption">{band.label}</AppText>
                </Cell>
                <Cell>
                  <AppText
                    variant="caption"
                    style={settled.color ? { color: settled.color } : undefined}
                  >
                    {settled.text}
                    <AppText variant="axisTick" tone="muted">
                      {' '}
                      ×{band.n}
                    </AppText>
                  </AppText>
                </Cell>
                <Cell>
                  <AppText variant="caption" tone="muted">
                    {band.avgPeakBpm ?? '—'}
                    <AppText variant="axisTick" tone="muted">
                      {' '}
                      bpm
                    </AppText>
                  </AppText>
                </Cell>
              </Row>
            );
          })}
        </View>
      )}
      <AppText variant="axisTick" tone="muted">
        A bigger drop = your heart settles faster between sets (better cardio fitness). This is
        cardiovascular recovery only — not CNS or muscular readiness.
      </AppText>
    </Card>
  );
}

function Box({ children, flex }: { children: ReactNode; flex?: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flex: flex ? 1 : undefined,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radii.control,
        padding: theme.spacing.md,
        gap: theme.spacing.xs,
      }}
    >
      {children}
    </View>
  );
}

function Stat({
  value,
  unit,
  label,
  color,
}: {
  value: string;
  unit: string;
  label: string;
  color?: string;
}) {
  return (
    <Box flex>
      <View
        accessible
        accessibilityLabel={`${label}: ${value}${value === '—' ? '' : ` ${unit}`}`}
        style={{ alignItems: 'center' }}
      >
        <AppText variant="weekTileValue" style={color ? { color } : undefined}>
          {value}
          <AppText variant="micro" tone="muted">
            {' '}
            {unit}
          </AppText>
        </AppText>
        <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
          {label}
        </AppText>
      </View>
    </Box>
  );
}

function Trend({ label, values, color }: { label: string; values: number[]; color: string }) {
  return (
    <Box flex>
      <AppText variant="axisTick" tone="muted">
        {label}
      </AppText>
      <LineChart
        label={label}
        height={36}
        showLabels={false}
        fill
        stretch
        dots="none"
        color={color}
        points={values.map((value, index) => ({ label: String(index + 1), value }))}
      />
    </Box>
  );
}

function Row({ children, last, label }: { children: ReactNode; last?: boolean; label?: string }) {
  const { theme } = useTheme();
  return (
    <View
      accessible={label !== undefined}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      {children}
    </View>
  );
}

function Cell({ children, first }: { children: ReactNode; first?: boolean }) {
  return <View style={first ? { width: 64 } : { flex: 1 }}>{children}</View>;
}
