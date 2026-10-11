import { ScrollView, View } from 'react-native';
import { recoveryBand } from '@trainingai/shared/health/recovery-band';
import { AppText, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { MuscleRecovery } from '../catalog';

export function RecoveryRow({ muscles }: { muscles: MuscleRecovery[] }) {
  const { theme } = useTheme();
  if (!muscles.length) {
    return null;
  }
  return (
    <Stack direction="row" align="center" gap="sm">
      <AppText variant="micro" tone="muted">
        RECOVERY
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1, height: theme.spacing.xxl }}
        contentContainerStyle={{ gap: theme.spacing.xs }}
      >
        {muscles.map(({ muscle, pct }) => {
          const band = recoveryBand(pct).key;
          const color =
            theme.anatomy[
              band === 'recovered' ? 'main' : band === 'partial' ? 'secondary' : 'injured'
            ];
          return (
            <View
              key={muscle}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
                borderRadius: theme.radii.small,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
                borderWidth: 1,
                borderColor: `${color}4d`,
                backgroundColor: `${color}1a`,
              }}
            >
              <AppText variant="micro" style={{ color }}>
                {Math.round(pct)}%
              </AppText>
              <AppText variant="micro" tone="muted">
                {muscle.charAt(0).toUpperCase() + muscle.slice(1)}
              </AppText>
            </View>
          );
        })}
      </ScrollView>
    </Stack>
  );
}
