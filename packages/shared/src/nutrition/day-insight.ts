interface InsightInput {
  batteryCurrent: number | null; batteryDrained: number | null
  scales: { physicalTiredness: number; mentalDrain: number; barelyMoved: number; hydration: number; lateHeavyMeal: number }
  soreMuscles: string[]
}
export function buildTodayInsight(i: InsightInput): string {
  const parts: string[] = []
  if (i.batteryCurrent != null) parts.push(`Body Battery ${i.batteryCurrent}${i.batteryDrained != null ? ` (down ${i.batteryDrained})` : ''}`)
  if (i.scales.physicalTiredness >= 4) parts.push('physically drained')
  if (i.scales.mentalDrain >= 4) parts.push('mentally taxed')
  if (i.scales.lateHeavyMeal >= 4) parts.push('a late / heavy meal')
  if (i.scales.hydration >= 4) parts.push('low hydration')
  if (i.scales.barelyMoved >= 4) parts.push('very little movement')
  if (i.soreMuscles.length) parts.push(`sore ${i.soreMuscles.slice(0, 3).join(', ').toLowerCase()}`)
  if (parts.length <= 1) return `${parts[0] ?? 'A steady day'} — nothing stands out today.`
  return `Today: ${parts.join(', ')}. Over time we'll learn which of these track with your drained days.`
}
