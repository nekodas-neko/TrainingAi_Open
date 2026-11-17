import { formatDateDisplay, shiftDateStr } from '@trainingai/shared/date-utils';
import type { BodyRow } from './models';

const fmt = (value: number | null | undefined, unit: string) => (value == null ? null : `${value}${unit}`);

/**
 * The scale figures worked out from weight, height, age and sex rather than from the impedance
 * reading (#3770). They are labelled as estimates and folded away under the measured two.
 */
export function scaleEstimates(row: BodyRow) {
  return [
    { label: 'Skeletal Muscle', value: fmt(row.skeletalMusclePct, '%') },
    { label: 'Fat-Free Mass', value: fmt(row.fatFreeMassKg, ' kg') },
    { label: 'Muscle Mass', value: fmt(row.muscleMassKg, ' kg') },
    { label: 'Body Water', value: fmt(row.bodyWaterPct, '%') },
    { label: 'Bone Mass', value: fmt(row.boneMassKg, ' kg') },
    { label: 'Visceral Fat', value: fmt(row.visceralFatIndex, '') },
    { label: 'BMR', value: fmt(row.bmrKcal, ' kcal') },
    { label: 'Protein', value: fmt(row.proteinPct, '%') },
    { label: 'Subcutaneous Fat', value: fmt(row.subcutaneousFatPct, '%') },
    { label: 'Metabolic Age', value: fmt(row.metabolicAge, ' yrs') },
  ].filter((tile): tile is { label: string; value: string } => tile.value !== null);
}

/** "today", "yesterday", or the date, for the weigh-in the card reads from. */
export function weighInDay(date: string, today: string) {
  if (date === today) return 'today';
  if (date === shiftDateStr(today, -1)) return 'yesterday';
  return `on ${formatDateDisplay(date, 'short')}`;
}
