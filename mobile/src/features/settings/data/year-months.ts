// The current app's Your Year chart labels each bar with a three-letter month. `toLocaleDateString`
// with en-AU gives "Sept" for September on current ICU, which no longer fits the bar's column and
// wrapped to "Sep" over "t" (#3517), so the names are fixed here.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The twelve month labels ending at `now`'s month, oldest first. */
export function lastTwelveMonthLabels(now: Date): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return MONTH_NAMES[date.getMonth()];
  });
}
