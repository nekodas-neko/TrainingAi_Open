import { formatDateDisplay, formatTime12h } from '../date-utils'

interface ActivityRowFigures {
  date: string
  startTime?: string | null
  durationMin?: number | null
  distanceKm?: number | null
  caloriesBurned?: number | null
}

/**
 * What an activity-history row prints beside its title: date, clock time and rounded minutes on
 * the left; distance (two decimals) and rounded kcal on the right. Each figure appears only when
 * the activity has it, never as a placeholder dash.
 */
export function activityRowText(log: ActivityRowFigures): { subtitle: string; facts: string[] } {
  const subtitle = [
    formatDateDisplay(log.date),
    log.startTime ? formatTime12h(log.startTime) : '',
    log.durationMin ? `${Math.round(log.durationMin)} min` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const facts = [
    log.distanceKm != null ? `${Number(log.distanceKm).toFixed(2)} km` : '',
    log.caloriesBurned != null ? `${Math.round(log.caloriesBurned)} kcal` : '',
  ].filter(Boolean)
  return { subtitle, facts }
}
