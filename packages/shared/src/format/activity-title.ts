/** An activity's title as shown: Health Connect imports arrive as `EXERCISE_TYPE_OPEN_WATER_SWIMMING`
 *  and read "Open Water Swimming" with its qualifier in brackets. Anything else is left alone. */
export function formatActivityTitle(title: string): string {
  if (!title.startsWith('EXERCISE_TYPE_')) return title
  return title
    .replace('EXERCISE_TYPE_', '')
    .split('_')
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
    .replace('Treadmill', '(Treadmill)')
    .replace('Pool', '(Pool)')
    .replace('Open Water', '(Open Water)')
    .replace('Stationary', '(Stationary)')
}
