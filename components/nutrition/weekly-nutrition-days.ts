/**
 * RV-218 ④. What the 7-day chart needs to know about its rows, kept out of the component so it can
 * be tested (vitest cannot parse the JSX file).
 *
 * The route now returns all seven days, with `logged: false` on a day with no food logged. A row
 * from before that change has no `logged` field and only ever held logged days, so absent means
 * logged. It also has no `isToday`, so the old "last row is today" rule is the fallback.
 */
export interface WeeklyDay {
  date: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  logged?: boolean
  isToday?: boolean
}

export function weeklyChartModel(data: WeeklyDay[]) {
  const isLogged = (d: WeeklyDay) => d.logged !== false
  const logged = data.filter(isLogged)
  const marked = data.findIndex(d => d.isToday === true)
  const anyMarked = data.some(d => d.isToday !== undefined)
  return {
    /** The bar to emphasise as today, or -1 when today is not in the window. */
    todayIndex: marked >= 0 ? marked : anyMarked ? -1 : data.length - 1,
    loggedDays: logged.length,
    /** Mean calories over LOGGED days only; an unlogged day is not a 0 kcal day. */
    avgCalories: logged.length > 0 ? Math.round(logged.reduce((s, d) => s + d.calories, 0) / logged.length) : null,
    hasAnyLogged: logged.length > 0,
  }
}
