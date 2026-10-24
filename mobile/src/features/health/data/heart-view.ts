// Heart rate screen wording kept out of the components so it can be tested (#2933).

// trend-sparkline.tsx: every 14-day card's title reads "<label> — 14 days", with the missing-days
// note, when there is one, set after it in lower case.
export function trendCardTitle(label: string) {
  return `${label} — 14 days`;
}
