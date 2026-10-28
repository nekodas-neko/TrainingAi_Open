import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText, Card, Stack, ZoneGauge } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { BULLET_GLYPH, bulletLayout, explainerBadge } from '../data/explainer-card';

// The explainer the current app shows under a score (contributor-details.tsx and
// contributor-detail.tsx): one card per factor with its name, a coloured band badge, a zone gauge,
// then What it measures / Measured against / What your score means / How to improve it. Readiness,
// Sleep and Heart rate all draw it here, so they cannot drift apart again (#3507).
export function ExplainerCard({
  label,
  score,
  gauge,
  measures,
  against,
  meaning,
  extra,
  remediate,
  footer,
}: {
  label: string;
  /** The factor's 0-100 score; null when it is learning or unscored (no badge, no gauge). */
  score: number | null;
  /** Gauge marker 0-100 for a middle-is-best metric; omitted draws a toward-high gauge from the score. */
  gauge?: number;
  measures: string;
  against: string;
  meaning: string;
  /** "Your values" line, e.g. recent HRV. */
  extra?: string;
  remediate: string[];
  footer?: string;
}) {
  const { theme } = useTheme();
  const badge = explainerBadge(score, theme.status);
  return (
    <Card>
      <Stack direction="row" justify="space-between" align="baseline">
        <AppText variant="subheading" style={{ flex: 1 }}>
          {label}
        </AppText>
        {badge && (
          <AppText variant="explainerBadge" style={{ color: badge.color, fontVariant: ['tabular-nums'] }}>
            {badge.text}
          </AppText>
        )}
      </Stack>
      {gauge != null ? <ZoneGauge centered value={gauge} /> : badge ? <ZoneGauge value={score!} /> : null}
      <View style={{ gap: theme.spacing.snug }}>
        <Field title="What it measures">{measures}</Field>
        <Field title="Measured against">{against}</Field>
        {extra && <Field title="Your values">{extra}</Field>}
        {score != null ? (
          <Field title="What your score means">{meaning}</Field>
        ) : (
          <AppText variant="explainerBody" tone="muted">
            {meaning}
          </AppText>
        )}
        <View style={{ gap: theme.spacing.xxs }}>
          <AppText variant="explainerLabel" tone="muted">
            How to improve it
          </AppText>
          <View style={{ gap: theme.spacing.xxs }}>
            {remediate.map((tip) => (
              <Bullet key={tip}>{tip}</Bullet>
            ))}
          </View>
        </View>
        {footer && (
          <AppText variant="explainerBody" tone="muted">
            {footer}
          </AppText>
        )}
      </View>
    </Card>
  );
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.spacing.xxs }}>
      <AppText variant="explainerLabel" tone="muted">
        {title}
      </AppText>
      <AppText variant="explainerBody" tone="muted">
        {children}
      </AppText>
    </View>
  );
}

// A dot in a fixed column and the text beside it, so a wrapped line hangs under the text.
function Bullet({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const layout = bulletLayout(theme.spacing.lg);
  return (
    <View style={layout.row}>
      <AppText variant="explainerBody" tone="muted" style={layout.dot} accessibilityElementsHidden>
        {BULLET_GLYPH}
      </AppText>
      <AppText variant="explainerBody" tone="muted" style={layout.text}>
        {children}
      </AppText>
    </View>
  );
}
