import { type ReactNode } from 'react';
import { View } from 'react-native';
import { Pressable } from '../../../shared/ui/Pressable';
import { AppText } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHome } from '../data/HomeProvider';
import { readinessCardLine } from '../data/readiness-prompt';
import { useReadinessQuestion } from '../data/useReadinessQuestion';

/**
 * Home's readiness card (#2106): the score stated, usual or not (the question is the unusual-day
 * card's, #3953). Soreness logging stays one tap away every day, because it still lightens that
 * day's loads. `logged` is the card as it already showed an energy log.
 */
export function ReadinessPromptCard({
  openReadiness,
  logged,
}: {
  openReadiness: () => void;
  logged: ReactNode;
}) {
  const { theme } = useTheme();
  const home = useHome();
  // The question itself lives in Home's unusual-day card (#3953); here the score is only stated.
  const { prompt } = useReadinessQuestion();
  const line = readinessCardLine(prompt);
  const soreness = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Log soreness"
      onPress={openReadiness}
      hitSlop={theme.spacing.xs}
      style={{
        minHeight: theme.sizes.touchTarget,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.raised,
      }}
    >
      <AppText variant="label">Log soreness</AppText>
    </Pressable>
  );
  // An energy log already on the card is more than the one line says, so it stays.
  if (home.mood) {
    return <>{logged}</>;
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radii.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: `${theme.colors.raised}80`,
      }}
    >
      <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
        {line ? `${line} Sore somewhere?` : 'Sore somewhere?'}
      </AppText>
      {soreness}
    </View>
  );
}
