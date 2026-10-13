import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { guideFor } from '@trainingai/shared/health/contributor-guide';
import { scoreBand } from '@trainingai/shared/health/score-band';
import { AppText, Badge, Card, ProgressBar, Stack, ZoneGauge } from '../../../shared/ui';
import { useHealthAnchor } from '../../../shared/ui/HealthDetailLayout';
import { useTheme } from '../../../shared/theme/ThemeProvider';
type Factor = {
  key: string;
  label: string;
  score?: number | null;
  provisional?: boolean;
  extra?: string;
  weight?: number;
  gauge?: number;
};
const names: Record<string, string> = {
  hrvBalance: 'HRV balance',
  prevDayActivity: 'Previous day activity',
  temperature: 'Body temperature',
  hrv: 'HRV',
  hr: 'Heart rate',
  schedule: 'Sleep schedule',
  strengthFreq: 'Training frequency (7d)',
  strengthVolume: 'Training volume (7d)',
  moveHours: 'Move every hour',
};
function labelFor(key: string) {
  return (
    names[key] ??
    key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, (x) => x.toUpperCase())
  );
}
export function ContributorDetails({
  factors,
  title = 'What each factor means',
  nodes,
}: {
  factors: Factor[];
  title?: string;
  nodes?: Map<string, View>;
}) {
  return (
    <>
      <AppText variant="eyebrow" tone="muted">
        {title}
      </AppText>
      {factors
        .filter((f) => guideFor(f.key))
        .map((f) => {
          const guide = guideFor(f.key)!;
          const band = f.score != null && !f.provisional ? scoreBand(f.score) : null;
          return (
            <View
              key={f.key}
              collapsable={false}
              ref={(node) => {
                if (node) {
                  nodes?.set(f.key, node);
                } else {
                  nodes?.delete(f.key);
                }
              }}
            >
              <Card>
                <Stack direction="row" justify="space-between">
                  <AppText variant="label" style={{ flex: 1 }}>
                    {f.label}
                  </AppText>
                  {band && <Badge label={`${band.label} · ${f.score}`} />}
                </Stack>
                {f.gauge != null ? (
                  <ZoneGauge centered value={f.gauge} />
                ) : band ? (
                  <ZoneGauge value={f.score!} />
                ) : null}
                <AppText variant="micro" tone="muted">
                  What it measures
                </AppText>
                <AppText variant="caption">{guide.measures}</AppText>
                <AppText variant="micro" tone="muted">
                  Measured against
                </AppText>
                <AppText variant="caption">{guide.against}</AppText>
                <AppText variant="micro" tone="muted">
                  What your score means
                </AppText>
                <AppText variant="caption">
                  {f.provisional
                    ? 'Still learning your personal baseline — this factor stays neutral until enough nights of data accrue.'
                    : f.score != null && f.score < 50
                      ? guide.low
                      : guide.high}
                </AppText>
                {f.extra && (
                  <>
                    <AppText variant="micro" tone="muted">
                      Your values
                    </AppText>
                    <AppText variant="caption">{f.extra}</AppText>
                  </>
                )}
                <AppText variant="micro" tone="muted">
                  How to improve it
                </AppText>
                {guide.remediate.map((text) => (
                  <AppText key={text} variant="caption">
                    • {text}
                  </AppText>
                ))}
                {f.weight != null && (
                  <AppText variant="micro" tone="muted">
                    Weighted {Math.round(f.weight * 100)}% of your energy score.
                  </AppText>
                )}
              </Card>
            </View>
          );
        })}
    </>
  );
}
export function ContributorCard({
  title,
  contributors,
  weights,
  provisional = [],
  extras,
  temperature,
}: {
  title: string;
  contributors: Record<string, number | null> | null | undefined;
  weights?: Record<string, number>;
  provisional?: string[];
  extras?: Record<string, string>;
  temperature?: number | null;
}) {
  const nodes = useRef(new Map<string, View>());
  const jump = useHealthAnchor();
  const { theme } = useTheme();
  const factors = Object.entries(
    weights
      ? Object.fromEntries(
          Object.keys(weights).map((key) => [key, contributors?.[key] ?? null]),
        )
      : (contributors ?? {}),
  )
    .filter(([, v]) => weights || v !== null)
    .sort((a, b) => {
      const aa = provisional.includes(a[0]) ? null : a[1];
      const bb = provisional.includes(b[0]) ? null : b[1];
      return aa != null && bb != null
        ? aa - bb
        : aa != null
          ? -1
          : bb != null
            ? 1
            : (weights?.[b[0]] ?? 0) - (weights?.[a[0]] ?? 0);
    })
    .map(([key, score]) => ({
      key,
      score,
      label: labelFor(key),
      provisional: score == null || provisional.includes(key),
      weight: weights?.[key],
      extra: extras?.[key],
      gauge:
        key === 'temperature' && temperature != null
          ? Math.max(0, Math.min(100, ((temperature + 1.5) / 3) * 100))
          : undefined,
    }));
  if (!factors.length) {
    return null;
  }
  return (
    <>
      <Card>
        <AppText variant="eyebrow" tone="muted">
          {title}
        </AppText>
        {factors.map((f) => (
          <Pressable
            key={f.key}
            accessibilityRole="button"
            accessibilityLabel={`Explain ${f.label}`}
            onPress={() => jump(nodes.current.get(f.key) ?? null)}
            style={{
              minHeight: theme.sizes.touchTarget,
              justifyContent: 'center',
              gap: theme.spacing.xs,
            }}
          >
            <Stack direction="row" justify="space-between">
              <AppText variant="caption">{f.label}</AppText>
              <AppText variant="label">
                {f.provisional
                  ? weights?.[f.key] != null
                    ? `${Math.round(weights[f.key] * 100)}% weight`
                    : 'Building baseline'
                  : f.score}
              </AppText>
            </Stack>
            <ProgressBar
              value={f.provisional ? (f.weight ?? 0) : f.score! / 100}
              color={
                f.provisional
                  ? undefined
                  : scoreBand(f.score!).label === 'High'
                    ? theme.anatomy.main
                    : scoreBand(f.score!).label === 'Moderate'
                      ? theme.anatomy.secondary
                      : theme.anatomy.injured
              }
            />
          </Pressable>
        ))}
      </Card>
      <ContributorDetails factors={factors} nodes={nodes.current} />
    </>
  );
}
