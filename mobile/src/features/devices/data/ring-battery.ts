import { z } from 'zod';
import { decideLowBatteryAlert } from '@trainingai/shared/devices/low-battery';
import { formatHoursMinutes } from '@trainingai/shared/format/units';

// The Oura ring's battery on the Devices screen (#3069): the readings come from the server, the
// alert level and its state stay on this phone.
export const RING_ALERT_KEY = 'ring-battery-alert.v1';
export const RING_ALERT_LEVELS = [10, 15, 20, 25, 30] as const;
/** A reading older than this is not news: opening the app after a day away must not alert. */
export const MAX_ALERT_AGE_MIN = 24 * 60;

const alertSchema = z.object({
  enabled: z.boolean().catch(true),
  level: z.number().catch(20),
  fired: z.boolean().catch(false),
});
export type RingAlertSettings = z.infer<typeof alertSchema>;
export const DEFAULT_RING_ALERT: RingAlertSettings = { enabled: true, level: 20, fired: false };

export function parseRingAlert(raw: string | null): RingAlertSettings {
  try {
    const parsed = alertSchema.safeParse(raw ? JSON.parse(raw) : null);
    return parsed.success ? parsed.data : DEFAULT_RING_ALERT;
  } catch {
    return DEFAULT_RING_ALERT;
  }
}

/**
 * The saved alert with its open spell closed, for when the phone changes hands: the new owner's
 * first low reading must alert. The level and the on/off the person chose are kept. Null when
 * nothing was saved.
 */
export function clearRingAlertFired(raw: string | null): string | null {
  return raw === null ? null : JSON.stringify({ ...parseRingAlert(raw), fired: false });
}

/** Whether this reading starts a low spell, and the settings to save: at most once per spell. */
export function checkRingAlert(
  settings: RingAlertSettings,
  reading: { percent: number; charging: boolean; ageMinutes: number } | null,
): { notify: boolean; settings: RingAlertSettings } {
  if (!reading || reading.ageMinutes > MAX_ALERT_AGE_MIN) return { notify: false, settings };
  const decision = decideLowBatteryAlert(
    reading.percent,
    reading.charging,
    settings.fired,
    settings.level,
  );
  // Off, it never alerts and leaves an open spell open, so turning it on mid-spell alerts once.
  const fired = decision.notify && !settings.enabled ? settings.fired : decision.fired;
  return { notify: decision.notify && settings.enabled, settings: { ...settings, fired } };
}

export function readingAge(minutes: number) {
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

export function daysLeftText(days: number) {
  if (days < 1) return 'less than a day';
  const rounded = Math.round(days);
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`;
}

export const chargeTimeText = (seconds: number) => formatHoursMinutes(seconds / 60);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The drain chart's points, and a month name under the first point of each month. */
export function drainChart(series: readonly { day: string; drainPct: number }[]) {
  let month = '';
  return {
    points: series.map(({ day, drainPct }) => ({
      label: day,
      value: drainPct,
      x: Date.parse(`${day}T12:00:00Z`),
    })),
    axisLabels: series.map(({ day }) => {
      const name = MONTHS[Number(day.slice(5, 7)) - 1] ?? '';
      if (name === month) return '';
      month = name;
      return name;
    }),
  };
}
