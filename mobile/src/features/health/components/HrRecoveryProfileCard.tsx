import type { ReactNode } from 'react';
import { View } from 'react-native';
import { informativeShareNote } from '@trainingai/shared/health/hr-recovery-honesty';
import { AppText, Card, LineChart, Stack, StableContent } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { hrRecoveryProfileSpec } from '../data/models';
import { rateDisplay, sourceMixLabel, trendSeries } from '../data/hr-recovery-view';
import { HealthResourceHeader } from './HealthResourceHeader';

// The current app's card (components/health/hr-recovery-profile-card.tsx): recovery rate bucketed
// by the heart rate being recovered from, a month-over-month line per band, and the caveats.
// Like the web card it renders nothing until there is at least one band.
export function HrRecoveryProfileCard() {
  const { theme } = useTheme();
  const state = useWorkoutResource(hrRecoveryProfileSpec);
  const profile = state.data;
  if (profile && profile.bands.length === 0) {
    return null;
  }
  const note = profile ? informativeShareNote(profile.informativeShare) : null;
  const trends = profile ? trendSeries(profile.trend) : [];
  const cyan = theme.training.activity;
  const amber = theme.status.warning;
  return (
    <Card>
      <HealthResourceHeader title="HR Recovery Profile" state={state} refresh={state.refresh} />
      <StableContent loading={profile === null && state.loading}>
        {profile && (
          <Stack>
            <AppText variant="caption" tone="muted">
              How fast your heart rate settles, grouped by how hard you were working. A bigger
              drop/min means faster recovery — generally a sign of better cardio fitness.
            </AppText>
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.control,
                overflow: 'hidden',
              }}
            >
              <Row>
                <Cell width={76}>
                  <AppText variant="axisTick" tone="muted">
                    Peak HR
                  </AppText>
                </Cell>
                <Cell flex>
                  <AppText variant="axisTick" tone="muted">
                    Recovery rate
                  </AppText>
                </Cell>
                <Cell width={44} end>
                  <AppText variant="axisTick" tone="muted">
                    n
                  </AppText>
                </Cell>
              </Row>
              {profile.bands.map((band, index) => {
                const rate = rateDisplay(band.medianRateBpmMin);
                const mix = sourceMixLabel(band.bySource);
                return (
                  <Row
                    key={band.label}
                    last={index === profile.bands.length - 1}
                    dimmed={band.lowSignal}
                    label={`Peak ${band.label} bpm, ${rate.text}${band.medianRateBpmMin == null ? '' : ' bpm per minute'}, ${band.n} recoveries`}
                  >
                    <Cell width={76}>
                      <AppText variant="caption">{band.label}</AppText>
                    </Cell>
                    <Cell flex>
                      <AppText
                        variant="caption"
                        style={
                          rate.direction
                            ? { color: rate.direction === 'down' ? cyan : amber }
                            : undefined
                        }
                      >
                        {rate.text}
                        {band.medianRateBpmMin != null && (
                          <AppText variant="axisTick" tone="muted">
                            {' '}
                            bpm/min
                          </AppText>
                        )}
                        {band.recoveredPct != null && (
                          <AppText variant="axisTick" tone="muted">
                            {'  '}· {band.recoveredPct}% fully recovered
                          </AppText>
                        )}
                      </AppText>
                      {mix && (
                        <AppText variant="axisTick" tone="muted">
                          Mixed: {mix}
                        </AppText>
                      )}
                    </Cell>
                    <Cell width={44} end>
                      <AppText variant="caption" tone="muted">
                        ×{band.n}
                      </AppText>
                    </Cell>
                  </Row>
                );
              })}
            </View>
            {profile.bands.some((band) => band.lowSignal) && (
              <AppText variant="axisTick" tone="muted">
                Dimmed band: HR barely elevated — recovery there is mostly noise, not signal.
              </AppText>
            )}
            {note && (
              <AppText
                variant="axisTick"
                tone="muted"
                style={note.minority ? { color: amber } : undefined}
              >
                {note.minority
                  ? `Only ${note.pct}% of your recorded rests get your heart rate high enough for this to read — the dimmed bands are the rest of them. Treat the table as a partial picture.`
                  : `${note.pct}% of your recorded rests get your heart rate high enough for this to read.`}
              </AppText>
            )}
            {trends.length > 0 && (
              <Stack gap="xs">
                <AppText variant="axisTick" tone="muted">
                  Recovery rate over time — rising means faster recovery (fitter)
                </AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  {trends.map((trend) => (
                    <View
                      key={trend.label}
                      style={{
                        flexBasis: '47%',
                        flexGrow: 1,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: theme.radii.control,
                        padding: theme.spacing.md,
                        gap: theme.spacing.xs,
                      }}
                    >
                      <AppText variant="axisTick" tone="muted">
                        {trend.label} bpm
                      </AppText>
                      <LineChart
                        label={`Recovery rate for peak ${trend.label} bpm`}
                        height={32}
                        showLabels={false}
                        fill
                        stretch
                        dots="none"
                        color={cyan}
                        points={trend.values.map((value, index) => ({
                          label: String(index + 1),
                          value,
                        }))}
                      />
                    </View>
                  ))}
                </View>
              </Stack>
            )}
            <AppText variant="axisTick" tone="muted">
              Cardiovascular recovery only — not CNS or muscular readiness. Built from
              weight-training rests and workout cooldowns (e.g. runs). A “Mixed” band combines
              sources that may recover at different rates for reasons other than fitness — worth
              reading with that in mind.
            </AppText>
          </Stack>
        )}
      </StableContent>
    </Card>
  );
}

function Row({
  children,
  last,
  dimmed,
  label,
}: {
  children: ReactNode;
  last?: boolean;
  dimmed?: boolean;
  label?: string;
}) {
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
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      {children}
    </View>
  );
}

function Cell({
  children,
  width,
  flex,
  end,
}: {
  children: ReactNode;
  width?: number;
  flex?: boolean;
  end?: boolean;
}) {
  return (
    <View style={{ width, flex: flex ? 1 : undefined, alignItems: end ? 'flex-end' : undefined }}>
      {children}
    </View>
  );
}
