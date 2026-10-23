import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { scoreColors } from '../../shared/theme/tokens.ts';
import { chipText, type ScoreChipModel } from '../home/data/score-chips.ts';

// What the home-screen widgets draw (modules/home-widgets, WidgetSnapshot.kt). Built only from
// data the app already holds, every value formatted here, so the widget never calls the server and
// never works anything out itself. Bump `v` with any change the Kotlin parser must know about.

export const WIDGET_SNAPSHOT_VERSION = 1;

export type WidgetScore = {
  label: string;
  value: string | null;
  /** The chip's colour in each theme; the widget follows the phone's dark or light mode. */
  color: { dark: string; light: string };
  qualified: boolean;
};
export type WidgetSnapshot = {
  v: typeof WIDGET_SNAPSHOT_VERSION;
  date: string;
  updated: string;
  today: { scores: WidgetScore[] };
};

export function todayWidgetSnapshot(
  date: string,
  chips: readonly ScoreChipModel[],
  now: Date,
  timezone: string,
): WidgetSnapshot {
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    date,
    updated: `Updated ${formatTimeOfDay(now, timezone)}`,
    today: {
      scores: chips.map((chip) => ({
        label: chip.label,
        value: chip.value === null && chip.display == null ? null : chipText(chip),
        color: { dark: scoreColors.dark[chip.key], light: scoreColors.light[chip.key] },
        qualified: chip.qualified,
      })),
    },
  };
}

/** Everything but the time, so redrawing the same numbers does not rewrite the widget. */
export function snapshotIdentity(snapshot: WidgetSnapshot): string {
  return JSON.stringify({ ...snapshot, updated: undefined });
}
