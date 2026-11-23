import { formatCount } from '@trainingai/shared/format/number';

export type YearTotals = {
  sessionCount: number;
  totalSets: number;
  totalVolumeKg: number;
  totalMinutes: number;
  prCount: number;
  longestWeeklyStreak: number;
};

/** The six totals as Your Year's tiles print them: counts through the one number formatter (#4090). */
export function yearTiles(data: YearTotals): { label: string; value: string; unit: string }[] {
  return [
    { label: 'Sessions', value: formatCount(data.sessionCount), unit: '' },
    { label: 'Sets', value: formatCount(data.totalSets), unit: '' },
    { label: 'Volume', value: formatCount(data.totalVolumeKg), unit: 'kg' },
    { label: 'Training time', value: formatCount(data.totalMinutes / 60), unit: 'h' },
    { label: 'Personal records', value: formatCount(data.prCount), unit: '' },
    { label: 'Best weekly streak', value: formatCount(data.longestWeeklyStreak), unit: 'weeks' },
  ];
}
