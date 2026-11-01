/**
 * Whether a typed-to-confirm phrase unlocks `ConfirmDialog`. Exact and case-sensitive after
 * trimming, so "delete" does not unlock a "DELETE" prompt; no phrase means always unlocked.
 * `ignoreCase` is for an email address, which a phone keyboard may capitalise and the server compares
 * without case anyway (#3369).
 */
export function phraseMatches(typed: string, phrase: string | undefined, ignoreCase = false): boolean {
  if (phrase === undefined) return true
  return ignoreCase ? typed.trim().toLowerCase() === phrase.toLowerCase() : typed.trim() === phrase
}
