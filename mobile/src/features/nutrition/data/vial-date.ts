import { shiftDateStr } from '@trainingai/shared/date-utils';
export const MAX_OPENED_DAYS_BACK = 180;
export function openedOnBounds(today: string): {
  min: string;
  max: string;
} {
  return { min: shiftDateStr(today, -MAX_OPENED_DAYS_BACK), max: today };
}
export function isOpenedOnValid(value: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { min, max } = openedOnBounds(today);
  return value >= min && value <= max;
}
export function openedOnProblem(value: string, today: string): string | null {
  if (isOpenedOnValid(value, today)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Pick the day you mixed this vial.';
  return value > today
    ? 'A vial cannot be opened in the future.'
    : `That is more than ${MAX_OPENED_DAYS_BACK} days ago — check the year.`;
}
