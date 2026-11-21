import { formatHoursMinutes } from '@trainingai/shared/format/units';

interface Night {
  deepSleepHours?: number | null;
  remSleepHours?: number | null;
  lightSleepHours?: number | null;
  awakHours?: number | null;
}

/**
 * The Sleep card's stage legend, in the current app's order (home-card-widget.tsx): Deep, REM, Light,
 * Awake, each with its time or "—" when the stage was not recorded. All four always show; the bar
 * above them only draws the stages that have time.
 */
export function sleepStageLegend(
  night: Night,
  colors: { deep: string; rem: string; light: string; awake: string },
) {
  return [
    { label: 'Deep', hours: night.deepSleepHours ?? null, color: colors.deep },
    { label: 'REM', hours: night.remSleepHours ?? null, color: colors.rem },
    { label: 'Light', hours: night.lightSleepHours ?? null, color: colors.light },
    { label: 'Awake', hours: night.awakHours ?? null, color: colors.awake },
  ].map((row) => ({
    ...row,
    text: row.hours == null ? '—' : formatHoursMinutes(row.hours * 60),
  }));
}

/**
 * The legend is one row in the current app (`flex gap-3`, never wrapped). Its items shrink with
 * their text instead of wrapping, down to this fraction of the 12 px size, so "Awake" cannot drop
 * to a second line when the system font is a little wider than the web's (#2903).
 */
export const SLEEP_LEGEND_MIN_FONT_SCALE = 0.8;
