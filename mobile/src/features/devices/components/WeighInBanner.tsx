import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText, Icon } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useScale, useScaleHold } from '../scale/ScaleProvider';
import { loggedBannerText, weighingBannerText } from '../scale/labels';

/** How long "NN.N kg logged" stays up after a weigh-in is filed. */
const LOGGED_MS = 4_000;

// The current app's weigh-in toast, on every Preview screen (#3158): holds the scale link while the
// app is in the foreground, shows "Weighing you… NN.N kg" as someone steps on, then "NN.N kg
// logged". Pending, declined and failed weigh-ins are answered on the Devices screen. Nothing is
// captured with the app closed.
export function WeighInBanner() {
  useScaleHold('app');
  const { state } = useScale();
  const { theme } = useTheme();
  const [logged, setLogged] = useState<string | null>(null);
  const result = state.result;
  useEffect(() => {
    const text = loggedBannerText(result);
    setLogged(text);
    if (!text) return;
    const timer = setTimeout(() => setLogged(null), LOGGED_MS);
    return () => clearTimeout(timer);
  }, [result]);
  const text = weighingBannerText(state) ?? logged;
  if (!text) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        top: theme.spacing.sm,
        left: theme.spacing.lg,
        right: theme.spacing.lg,
        zIndex: 10,
        elevation: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        borderRadius: theme.radii.card,
        borderWidth: 1,
        borderColor: theme.colors.brandBorder,
        backgroundColor: theme.colors.brandSurface,
      }}
    >
      <Icon name="scale" tone="brand" />
      <AppText variant="label" style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}
