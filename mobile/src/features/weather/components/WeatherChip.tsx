import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Pressable } from '../../../shared/ui/Pressable';
import { AppText, Icon, Sheet, Stack, type IconName } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWeather } from '../WeatherProvider';
import {
  isWeatherDay,
  temperatureLabel,
  WEATHER_TTL,
  type WeatherSnapshot,
} from '../data/models';
import { WeatherSettings } from './WeatherSettings';

const icons: Record<WeatherSnapshot['condition'], IconName> = {
  clear: 'sun',
  cloudy: 'cloud',
  rain: 'rain',
  fog: 'fog',
  snow: 'snow',
  thunderstorm: 'storm',
};
export function WeatherChip() {
  const { theme } = useTheme();
  const { settings, snapshot, busy, error } = useWeather();
  const [open, setOpen] = useState(false);
  if (!settings.enabled) return null;
  const day = snapshot ? isWeatherDay(snapshot) : false;
  const stale = !!snapshot && Date.now() - snapshot.fetchedAt >= WEATHER_TTL;
  const uv =
    day && snapshot?.uvIndex != null && snapshot.uvIndex >= 1
      ? Math.round(snapshot.uvIndex)
      : null;
  const label = snapshot
    ? `${snapshot.place.name}: ${temperatureLabel(snapshot, settings.unit)}, ${snapshot.condition}${uv != null ? `, UV ${uv}` : ''}${stale ? ', saved weather' : ''}. Weather settings`
    : 'Weather settings. Choose a city or use current location.';
  const chipHeight =
    (theme.typography.caption.lineHeight ?? theme.sizes.iconSmall) + theme.spacing.sm;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        // 24 dp drawn. The extra reach goes down over the date line, which is not tappable and
        // sits inside the same header column, so nothing above the header can clip it (#3759).
        hitSlop={{
          top: theme.spacing.sm,
          left: theme.spacing.sm,
          right: theme.spacing.sm,
          bottom: theme.sizes.touchTarget - chipHeight - theme.spacing.sm,
        }}
        style={{
          minHeight: chipHeight,
          width: theme.sizes.touchTarget * 3,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.raised,
          paddingHorizontal: theme.spacing.sm,
          justifyContent: 'center',
        }}
      >
        <Stack direction="row" align="center" gap="xs">
          {snapshot ? (
            <>
              <Icon
                name={
                  snapshot.condition === 'clear' && !day ? 'moon' : icons[snapshot.condition]
                }
                size={theme.sizes.iconSmall}
                tone="brand"
              />
              <AppText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                {temperatureLabel(snapshot, settings.unit)}
              </AppText>
              {uv != null && (
                <AppText
                  variant="micro"
                  numberOfLines={1}
                  style={{
                    color:
                      uv >= 11
                        ? theme.weatherColors.uvExtreme
                        : uv >= 8
                          ? theme.weatherColors.uvVeryHigh
                          : uv >= 6
                            ? theme.weatherColors.uvHigh
                            : uv >= 3
                              ? theme.weatherColors.uvModerate
                              : theme.weatherColors.uvLow,
                  }}
                >
                  UV {uv}
                </AppText>
              )}
              {stale && <Icon name="history" size={theme.sizes.iconSmall} tone="muted" />}
            </>
          ) : (
            <>
              {busy ? (
                <ActivityIndicator size="small" color={theme.colors.brandText} />
              ) : (
                <Icon name="cloud" size={theme.sizes.iconSmall} tone="muted" />
              )}
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {error ? 'Unavailable' : 'Weather'}
              </AppText>
            </>
          )}
        </Stack>
      </Pressable>
      <Sheet visible={open} title="Weather" onClose={() => setOpen(false)}>
        <View>
          <WeatherSettings />
        </View>
      </Sheet>
    </>
  );
}
