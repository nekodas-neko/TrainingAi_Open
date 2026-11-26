/** About's "What's new": the first points shown at once, the rest behind "Show all" (#4143). */
export const CHANGELOG_PREVIEW_POINTS = 3;

export function changelogPreview(changes: readonly string[], shown = CHANGELOG_PREVIEW_POINTS) {
  return { first: changes.slice(0, shown), rest: changes.slice(shown) };
}
