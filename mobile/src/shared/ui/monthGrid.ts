// The shape of a Monday-first month grid: blank cells before day 1, then the days, padded to whole
// weeks, so a month takes 4 to 6 rows.
export function monthGrid(month: string) {
  const [year, number] = month.split('-').map(Number);
  const first = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells = Math.ceil((first + count) / 7) * 7;
  return { first, count, cells, rows: cells / 7 };
}

/**
 * The title and the month controls share a row until text grows past this: at 384 px the controls
 * (two 48 px arrows, the w-24 month and the status slot) leave the title about 78 px, which holds
 * "TRAINING" and "CALENDAR" on two lines only up to about this scale.
 */
export const STACK_CALENDAR_TITLE_ABOVE = 1.1;

export function stackCalendarTitle(scale: number): boolean {
  return scale > STACK_CALENDAR_TITLE_ABOVE;
}
