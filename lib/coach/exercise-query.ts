/**
 * #3896 step 2: whether a program exercise's name answers the Coach's `query` on the "exercises"
 * choice source. Every word of the query, in any order, inside the name — so "cable pulldown" finds
 * "Cable Lat Pulldown". Case-insensitive; plain substring tests, no pattern built from the user's words.
 *
 * Lives here rather than in the options route because a Next.js route file may export only its
 * handlers.
 */
export function matchesExerciseQuery(name: string, query: string): boolean {
  const hay = name.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word))
}
