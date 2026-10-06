/**
 * Whether a typed-to-confirm phrase unlocks `ConfirmDialog`. Exact and case-sensitive after
 * trimming, so "delete" does not unlock a "DELETE" prompt; no phrase means always unlocked.
 */
export function phraseMatches(typed: string, phrase: string | undefined): boolean {
  return phrase === undefined || typed.trim() === phrase
}
