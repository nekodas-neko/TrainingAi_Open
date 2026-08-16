// Q-245 — deciding whether a food-log fetch may overwrite what is on screen.
//
// Nutrition keeps the previously rendered logs when a fetch comes back empty, so a transient empty
// response can't wipe a day's real (and possibly not-yet-synced) food. That guard used to compare
// only lengths, with no idea which date the data it was protecting belonged to — so swiping to a
// past day and back to a fresh today kept yesterday's meals: today's correct empty answer looked
// exactly like a hiccup. Extracted as a pure function so the three-way decision is testable.
export type LogsApplication = 'drop' | 'keep' | 'replace'

export function decideLogsApplication(input: {
  /** The date the resolved fetch was for. */
  fetchDate: string
  /** The date the user is looking at right now. */
  selectedDate: string
  /** The date the currently rendered logs belong to, or null if nothing has been rendered yet. */
  logsDate: string | null
  nextIsEmpty: boolean
  prevIsEmpty: boolean
}): LogsApplication {
  // Resolved after the user swiped away — painting it would show one day's food under another's
  // header, which is the same bug from the other direction.
  if (input.fetchDate !== input.selectedDate) return 'drop'
  // Only protect data that is actually for this date.
  if (input.logsDate === input.fetchDate && input.nextIsEmpty && !input.prevIsEmpty) return 'keep'
  return 'replace'
}
