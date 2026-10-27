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

/** Before the row is measured: stack by text scale alone, as the first paint has no widths yet. */
export function stackCalendarTitle(scale: number): boolean {
  return scale > STACK_CALENDAR_TITLE_ABOVE;
}

export interface CalendarTitleFit {
  /** Width of the whole calendar block. */
  rowWidth: number;
  /** Width of the month controls plus the status slot. */
  controlsWidth: number;
  /** Width the title takes on one line. */
  titleWidth: number;
  /** Breathing room kept between the title and the controls. */
  gap: number;
}

/**
 * Stack the title above the controls whenever the controls leave it less than its one-line width,
 * so "TRAINING CALENDAR" is never cut or broken mid-word, at any text scale or phone width. Once
 * measured this decides alone; the text scale only matters for the first paint.
 */
export function stackCalendarTitleToFit(fit: CalendarTitleFit): boolean {
  return fit.rowWidth - fit.controlsWidth - fit.gap < fit.titleWidth;
}
