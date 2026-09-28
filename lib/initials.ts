/**
 * The initials for an avatar placeholder (RV-207 ①).
 *
 * Three sites took `name.slice(0, 2)`, which is the first two LETTERS rather than the initials —
 * "Test User" rendered **TE** and "Zero Data" **ZE**. Correct for a single-word name by accident,
 * wrong for every name with a surname, which is most of them.
 *
 * First letter of the first word and of the last, so a middle name is skipped the way a person
 * would skip it. A single word falls back to its first two letters, which is the only case the
 * old behaviour got right and is still the best answer there.
 */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
