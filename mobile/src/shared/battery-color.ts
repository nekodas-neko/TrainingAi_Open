import { bodyBatteryBand, type BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band';

type BatteryTheme = {
  colors: { danger: string };
  tones: { checkin: { foreground: string }; activity: { foreground: string } };
};

/** The Body Battery bar colour: the shared bands (`bodyBatteryBand`), in theme colours rather than CSS variables. */
export function batteryColor(label: BodyBatteryLabel, theme: BatteryTheme) {
  const band = bodyBatteryBand(label);
  if (band === 'drained') return theme.colors.danger;
  if (band === 'low') return theme.tones.checkin.foreground;
  return theme.tones.activity.foreground;
}
