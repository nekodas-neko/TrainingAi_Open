/**
 * The "vs last week" cue on a 14-day trend: today's value against the average of the first seven
 * days of the window. `values` is oldest first, as `/api/health/trends` returns it. Null when
 * today has no value or the first week has none.
 */
export interface TrendDelta {
  direction: 'up' | 'down' | 'same'
  /** Whole-number size of the change, always >= 0. */
  amount: number
  /** "▲ 4 vs last week", "▼ 2 vs last week" or "— same as last week". */
  text: string
}

export function weekOverWeekChange(values: readonly (number | null | undefined)[]): TrendDelta | null {
  const today = values[values.length - 1]
  const weekAgo = values.slice(0, 7).filter((v): v is number => v != null)
  if (today == null || weekAgo.length === 0) return null
  const weekAvg = weekAgo.reduce((s, v) => s + v, 0) / weekAgo.length
  const diff = Math.round(today - weekAvg)
  if (diff === 0) return { direction: 'same', amount: 0, text: '— same as last week' }
  const up = diff > 0
  return {
    direction: up ? 'up' : 'down',
    amount: Math.abs(diff),
    text: `${up ? '▲' : '▼'} ${Math.abs(diff)} vs last week`,
  }
}
