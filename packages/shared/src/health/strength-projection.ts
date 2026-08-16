// Least-squares 1RM projection + plateau detection over a 90-day history series.
export interface RmPoint { date: string; rm: number }   // date: YYYY-MM-DD
export interface RmProjection {
  projectedRm: number     // 30 days past the last data point
  slopePerWeek: number    // kg/week
  plateau: boolean
}

export function linearFit(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } | null {
  if (points.length < 2) return null
  const n = points.length
  const mx = points.reduce((a, p) => a + p.x, 0) / n
  const my = points.reduce((a, p) => a + p.y, 0) / n
  let cov = 0, varX = 0
  for (const p of points) {
    cov += (p.x - mx) * (p.y - my)
    varX += (p.x - mx) ** 2
  }
  if (varX === 0) return null
  const slope = cov / varX
  return { slope, intercept: my - slope * mx }
}

const MS_PER_DAY = 86_400_000
// Plateau: ≥4 sessions spanning ≥21 days whose fitted trend moves less than
// 0.2% of the current 1RM per week (in either direction).
const PLATEAU_MIN_POINTS = 4
const PLATEAU_MIN_SPAN_DAYS = 21
const PLATEAU_PCT_PER_WEEK = 0.002

export function projectRm(history: RmPoint[], daysAhead = 30): RmProjection | null {
  if (history.length < 2) return null
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  const t0 = Date.parse(sorted[0].date)
  const pts = sorted.map(p => ({ x: (Date.parse(p.date) - t0) / MS_PER_DAY, y: p.rm }))
  const fit = linearFit(pts)
  if (!fit) return null
  const last = pts[pts.length - 1]
  const spanDays = last.x - pts[0].x
  const slopePerWeek = fit.slope * 7
  const plateau =
    pts.length >= PLATEAU_MIN_POINTS &&
    spanDays >= PLATEAU_MIN_SPAN_DAYS &&
    Math.abs(slopePerWeek) < PLATEAU_PCT_PER_WEEK * last.y
  return {
    projectedRm: parseFloat((last.y + fit.slope * daysAhead).toFixed(2)),
    slopePerWeek: parseFloat(slopePerWeek.toFixed(3)),
    plateau,
  }
}
