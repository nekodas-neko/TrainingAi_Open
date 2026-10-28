// The current app's Your Year chart labels each bar with a three-letter month. `toLocaleDateString`
// with en-AU gives "Sept" for September on current ICU, which no longer fits the bar's column and
// wrapped to "Sep" over "t" (#3517), so the names are fixed here.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The twelve month labels ending at the month of `today` (a YYYY-MM-DD in the user's timezone, from
 * `todayInTz`), oldest first. The server buckets the year by that timezone, so the device clock
 * would label the last bar wrong around a month's turn.
 */
export function lastTwelveMonthLabels(today: string): string[] {
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: 12 }, (_, i) => MONTH_NAMES[(((month - 11 + i) % 12) + 12) % 12]);
}
