import { bodyBatteryBand, type BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band';

type BatteryTheme = {
  colors: { danger: string };
  status: { success: string; warning: string };
};

/** The Body Battery bar colour: the shared bands (`bodyBatteryBand`), in theme colours rather than CSS variables. */
export function batteryColor(label: BodyBatteryLabel, theme: BatteryTheme) {
  const band = bodyBatteryBand(label);
  if (band === 'drained') return theme.colors.danger;
  if (band === 'low') return theme.status.warning;
  return theme.status.success;
}
