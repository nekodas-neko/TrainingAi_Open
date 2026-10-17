// The shape of a Monday-first month grid: blank cells before day 1, then the days, padded to whole
// weeks, so a month takes 4 to 6 rows.
export function monthGrid(month: string) {
  const [year, number] = month.split('-').map(Number);
  const first = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells = Math.ceil((first + count) / 7) * 7;
  return { first, count, cells, rows: cells / 7 };
}
