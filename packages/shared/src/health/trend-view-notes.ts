/**
 * One-line notes under a Trends card view, for views whose x-axis needs a word of explanation.
 * One place, so the web card and the native Progress card cannot word it differently.
 *
 * `meal-timing`: `food_logs.logged_at` is the eaten time, not the tap time (#212): the time the
 * person said, kept inside the meal's usual window, or the window's midpoint when none was given.
 */
export const TREND_VIEW_NOTE: Readonly<Record<string, string>> = {
  'meal-timing': "Meal times are when you said you ate, within each meal's usual window.",
}
