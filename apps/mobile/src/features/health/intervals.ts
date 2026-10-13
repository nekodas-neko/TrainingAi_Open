/** Union clipped intervals so duplicate sources and overlapping stages cannot inflate duration. */
export function coveredMinutes(intervals: { start: number; end: number }[], from: number, to: number): number {
  const clipped = intervals.map(x => ({ start: Math.max(from, x.start), end: Math.min(to, x.end) }))
    .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
    .sort((x, y) => x.start - y.start);
  let end = from;
  let total = 0;
  for (const interval of clipped) {
    total += Math.max(0, interval.end - Math.max(end, interval.start));
    end = Math.max(end, interval.end);
  }
  return total / 60_000;
}
