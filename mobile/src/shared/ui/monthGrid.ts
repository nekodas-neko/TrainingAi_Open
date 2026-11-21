// The shape of a Monday-first month grid: blank cells before day 1, then the days, padded to whole
// weeks, so a month takes 4 to 6 rows.
export function monthGrid(month: string) {
  const [year, number] = month.split('-').map(Number);
  const first = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells = Math.ceil((first + count) / 7) * 7;
  return { first, count, cells, rows: cells / 7 };
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
 * so "TRAINING CALENDAR" is never cut or broken mid-word, at any text scale or phone width.
 */
export function stackCalendarTitleToFit(fit: CalendarTitleFit): boolean {
  return fit.rowWidth - fit.controlsWidth - fit.gap < fit.titleWidth;
}

/**
 * Whether the title sits above the controls. Until the block, the controls and the title are all
 * measured it shares the row, which is where a phone at normal text size ends up (#2948): the
 * controls are 160 px, leaving a 384 px phone's title 152 px. A larger text size stacks it once
 * measured.
 */
export function calendarTitleStacked(fit: CalendarTitleFit | null): boolean {
  return fit !== null && stackCalendarTitleToFit(fit);
}
