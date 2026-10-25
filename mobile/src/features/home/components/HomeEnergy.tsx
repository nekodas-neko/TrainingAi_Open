import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Icon, Stack, StatusIndicator, AppButton } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { batteryColor } from '../../../shared/battery-color';
import { layoutMotion } from '../../../shared/ui/layoutMotion';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { batterySpec, readinessSpec } from '../../health/data/models';
import { BodyBatteryDetails } from '../../health/components/BodyBatteryDetails';
import type { HealthDetail } from '../../health/screens/HealthDetailScreen';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWeather } from '../../weather/WeatherProvider';
import { backgroundScene } from '../../weather/data/background';
import { useHome } from '../data/HomeProvider';
import { energyHero, energyHeroSize, type EnergyHeroSize } from '../data/energy-hero';
import { homeScoreChips } from '../data/score-chips';
import { EnergyGauge } from './EnergyGauge';
import { HomeScores } from './HomeScores';

// Home's hero (#2989): Energy, drawn live from Body Battery, replacing the Readiness chip and the
// Body Battery card. Sizes follow the approved mockups at 384 px: Full (D1 / R1), Compact (D3 /
// R4) and Slim (D4 / R8).
const GLASS = 'rgba(12,14,20,0.42)';
const GLASS_LINE = 'rgba(255,255,255,0.14)';
const GAUGE = {
  full: { size: 244, stroke: 15, number: 'energyFull' },
  compact: { size: 168, stroke: 12, number: 'energyCompact' },
  slim: { size: 112, stroke: 9, number: 'energySlim' },
} as const satisfies Record<EnergyHeroSize, { size: number; stroke: number; number: string }>;
const NUMBER_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.45)',
  textShadowRadius: 12,
  textShadowOffset: { width: 0, height: 1 },
};

export function HomeEnergy({ onOpen }: { onOpen: (detail: HealthDetail) => void }) {
  const { theme } = useTheme();
  const health = useHealthData();
  const home = useHome();
  const weather = useWeather();
  const reduced = useReducedMotion();
  const state = useWorkoutResource(batterySpec(health.today));
  const readiness = useWorkoutResource(readinessSpec(health.today));
  const [expanded, setExpanded] = useState(false);
  const size = energyHeroSize(home.preferences.energyHeroSize);
  // The dial sits over the wallpaper; with it off, the tide sits on the plain page.
  const onWallpaper = backgroundScene(weather.settings, 'home', null, null) !== null;
  const hero = energyHero(state.data);
  const geometry = GAUGE[size];
  const color = hero.hasData
    ? batteryColor(hero.label, {
        colors: theme.colors,
        tones: theme.tones,
        status: theme.status,
      })
    : theme.colors.muted;
  const showStatus = (state.loading && !state.data) || !!state.error;
  const number = hero.hasData ? String(hero.level) : '—';
  const sub = hero.hasData
    ? hero.sub
    : state.data
      ? 'No data yet'
      : 'Waiting for readings';
  const [, heart, sleep, activity] = homeScoreChips(
    readiness.data,
    health.sleep,
    health.today,
  );
  const eyebrow = (
    <Stack direction="row" align="center" gap="xs">
      <Icon name="power" size={theme.sizes.iconCompact} color={theme.colors.brand} />
      <AppText variant="eyebrow" style={{ color: theme.colors.brand }}>
        Energy
      </AppText>
    </Stack>
  );
  const band = hero.hasData ? (
    <View
      style={{
        alignSelf: size === 'full' ? 'center' : 'flex-start',
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xxs,
        borderRadius: theme.radii.pill,
        backgroundColor: onWallpaper ? GLASS : `${theme.colors.background}b8`,
      }}
    >
      <AppText
        variant="statLabel"
        style={{ color, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 }}
      >
        {hero.label}
      </AppText>
    </View>
  ) : null;
  const subText = (
    <AppText
      variant="micro"
      style={{ color: onWallpaper ? 'rgba(255,255,255,0.78)' : theme.colors.muted }}
    >
      {sub}
    </AppText>
  );
  const bigNumber = (
    <AppText
      variant={geometry.number}
      style={[{ fontVariant: ['tabular-nums'], color: '#fff' }, NUMBER_SHADOW]}
    >
      {number}
    </AppText>
  );
  const gauge = (
    <EnergyGauge
      shape={onWallpaper ? 'dial' : 'tide'}
      size={geometry.size}
      stroke={geometry.stroke}
      level={hero.hasData ? hero.level : null}
      morning={hero.hasData ? hero.morning : null}
    >
      {bigNumber}
      {size === 'full' && (
        <View style={{ alignItems: 'center', gap: theme.spacing.xxs, marginTop: theme.spacing.xs }}>
          {band}
          {subText}
        </View>
      )}
    </EnergyGauge>
  );
  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Energy"
      accessibilityValue={{
        text: hero.hasData ? `${hero.level}, ${hero.label}, ${hero.sub}` : sub,
      }}
      accessibilityHint={expanded ? 'Collapse details' : 'Expand details'}
      accessibilityState={{ expanded }}
      onPress={() => {
        layoutMotion(reduced);
        setExpanded((value) => !value);
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {size === 'full' ? (
        <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Stack direction="row" align="center" justify="space-between" style={{ alignSelf: 'stretch' }}>
            {eyebrow}
            {hero.hasData && (
              <AppText variant="micro" tone="muted">
                {hero.origin}
              </AppText>
            )}
          </Stack>
          {gauge}
        </View>
      ) : (
        <Stack direction="row" align="center" gap="md">
          {gauge}
          <Stack gap="xs" style={{ flex: 1 }}>
            {size === 'slim' ? (
              <AppText variant="eyebrow" style={{ color: theme.colors.brand }}>
                Energy{hero.hasData ? ` · ` : ''}
                {hero.hasData && <AppText variant="eyebrow" style={{ color }}>{hero.label}</AppText>}
              </AppText>
            ) : (
              <>
                {eyebrow}
                {band}
              </>
            )}
            {subText}
            {hero.hasData && hero.limited && (
              <AppText variant="micro" tone="muted">
                Limited data
              </AppText>
            )}
            {size === 'slim' && (
              <Stack direction="row" gap="md">
                {[
                  { chip: sleep, icon: 'moon' as const, color: theme.scores.sleep },
                  { chip: heart, icon: 'cardio' as const, color: theme.scores.heart },
                  { chip: activity, icon: 'flame' as const, color: theme.scores.activity },
                ].map(({ chip, icon, color: tint }) => (
                  <Stack key={chip.key} direction="row" align="center" gap="xxs">
                    <Icon name={icon} size={theme.sizes.iconCompact} color={tint} />
                    <AppText variant="label">
                      {chip.display ?? (chip.value === null ? '—' : Math.round(chip.value))}
                    </AppText>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      )}
    </Pressable>
  );
  const framed = size !== 'full';
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        style={
          framed
            ? {
                borderRadius: theme.radii.card,
                borderWidth: 1,
                borderColor: onWallpaper ? GLASS_LINE : theme.colors.border,
                backgroundColor: onWallpaper ? GLASS : theme.colors.raised,
                padding: theme.spacing.sm,
              }
            : undefined
        }
      >
        {body}
        {showStatus && (
          // Beside the Pressable, never inside it: a button inside a button.
          <View style={{ position: 'absolute', left: 0, top: 0 }}>
            <StatusIndicator
              label="Energy"
              busy={state.loading && !state.data}
              error={state.error}
              onRetry={state.refresh}
            />
          </View>
        )}
        {expanded && (
          <View style={{ marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
            {hero.hasData && hero.limited && size === 'full' && (
              <AppText variant="caption" tone="muted">
                Limited data: today's heart-rate readings are sparse, so treat the number as a
                rough guide.
              </AppText>
            )}
            <BodyBatteryDetails data={state.data} />
            <AppButton
              title="Readiness details"
              variant="surface"
              onPress={() => onOpen('readiness')}
            />
          </View>
        )}
      </View>
      {size !== 'slim' && <HomeScores onOpen={onOpen} />}
    </View>
  );
}
