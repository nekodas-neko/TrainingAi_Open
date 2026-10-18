import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { guideFor } from '@trainingai/shared/health/contributor-guide';
import { scoreBand } from '@trainingai/shared/health/score-band';
import { contributorNote } from '@trainingai/shared/health/score-gap-copy';
import { AppText, Badge, Card, Icon, Legend, ProgressBar, Stack, ZoneGauge } from '../../../shared/ui';
import { useHealthAnchor } from '../../../shared/ui/HealthDetailLayout';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { contributorFactors, type ContributorFactor } from '../data/contributor-factors';
import { weakestFactor } from '../data/week-view';
export function ContributorDetails({
  factors,
  title = 'What each factor means',
  nodes,
}: {
  factors: (Pick<ContributorFactor, 'key' | 'label'> & Partial<ContributorFactor>)[];
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
          const band = f.score != null && !f.learning ? scoreBand(f.score) : null;
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
                  {(f.provisional ? contributorNote(f) : null) ??
                    (f.score != null && f.score < 50 ? guide.low : guide.high)}
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
                    Weighted {Math.round(f.weight * 100)}% of your readiness score.
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
  cases,
  extras,
  temperature,
  note,
}: {
  /** An info line about missing inputs, shown under the intro (composite readiness only). */
  note?: string | null;
  title: string;
  contributors: Record<string, number | null> | null | undefined;
  weights?: Record<string, number>;
  provisional?: string[];
  /** Per-factor `gap` and `scale`, which pick the note a provisional factor shows. */
  cases?: Record<string, { gap?: unknown; scale?: unknown }>;
  extras?: Record<string, string>;
  temperature?: number | null;
}) {
  const nodes = useRef(new Map<string, View>());
  const jump = useHealthAnchor();
  const { theme } = useTheme();
  const factors = contributorFactors({ contributors, weights, provisional, cases, extras, temperature });
  if (!factors.length) {
    return null;
  }
  const weakest = weights ? null : weakestFactor(factors);
  const anyLearning = !!weights && factors.some((f) => f.learning);
  const bandColors: Record<string, string> = {
    High: theme.anatomy.main,
    Moderate: theme.anatomy.secondary,
    Low: theme.anatomy.injured,
  };
  return (
    <>
      <Card>
        <Stack direction="row" justify="space-between" align="center">
          <AppText variant="eyebrow" tone="muted" style={{ flexShrink: 1 }}>
            {title}
          </AppText>
          {weakest && (
            <AppText variant="micro" tone="muted">
              Weakest: <AppText variant="micro">{weakest}</AppText>
            </AppText>
          )}
        </Stack>
        {weights && (
          <AppText variant="caption" tone="muted">
            {factors.some((f) => f.score != null && !f.learning)
              ? 'Each factor scored against your own baselines. Tap one to jump to what it means and how to move it.'
              : 'Computed from your own baselines, weighted by how much each factor moves recovery. Scroll down for what each one means.'}
          </AppText>
        )}
        {!!note && (
          <Stack direction="row" gap="xs" align="flex-start">
            <Icon name="info" size={14} tone="muted" />
            <AppText variant="micro" tone="muted" style={{ flex: 1 }}>
              {note}
            </AppText>
          </Stack>
        )}
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
              <Stack direction="row" align="center" gap="xs" style={{ flex: 1 }}>
                <AppText variant="caption">{f.label}</AppText>
                {guideFor(f.key) && <Icon name="forward" size={14} tone="muted" />}
              </Stack>
              <AppText variant="label">
                {f.learning
                  ? weights?.[f.key] != null
                    ? `${Math.round(weights[f.key] * 100)}% weight`
                    : 'Building baseline'
                  : f.score}
              </AppText>
            </Stack>
            <ProgressBar
              value={f.learning ? (f.weight ?? 0) : f.score! / 100}
              color={
                f.learning
                  ? undefined
                  : bandColors[scoreBand(f.score!).label]
              }
            />
          </Pressable>
        ))}
        {!weights && (
          <Legend
            items={[
              { label: 'High 70+', color: bandColors.High },
              { label: 'Moderate 50+', color: bandColors.Moderate },
              { label: 'Low', color: bandColors.Low },
            ]}
          />
        )}
        {anyLearning && (
          <AppText variant="micro" tone="muted">
            Factors still learning your baseline show how much they count (%) instead of a score.
          </AppText>
        )}
      </Card>
      <ContributorDetails factors={factors} nodes={nodes.current} />
    </>
  );
}
