'use strict';
//
// A field the parser cannot see because someone put a warning sign in front of it.
//
// `Gate:`, `Needs:` and `Verify:` are read by matchers that anchor the field name directly after
// the bullet's `**`. ONE decorative character in between — `- **⚠ Gate: owner …` — makes the whole
// field invisible: `next-item.js` never parks the entry, and `check-backlog-pointers.js`'s
// inline-field guard cannot catch it either, because that guard's own pattern needs `**Gate:`
// adjacent.
//
// **Q-388 sat as Lane A's number-one READY item while its first bullet read `⚠ Gate: owner` and its
// second sentence said "treat this as blocked on a device reading, not on a decision."** Every Lane
// A session was served an entry that says outright it cannot be started; the previous session's
// baton compensated with prose — "the Tuning calibration block, owner-gated" — which is what a
// human writing around a broken tool looks like.
//
// The shape is worth its own check rather than a wider pattern, because a warning marker is exactly
// what someone reaches for when the gate matters MOST.

/** Decorations that are NOT a live declaration, and so are never flagged. */
const ALLOWED = new Set(['✅']);

/**
 * `{ decoration, field }` when a bullet declares a field behind a decoration, else null.
 *
 * Three forms are deliberately allowed, because none of them is a declaration:
 *  · a backtick — the Protocol section documents these fields by name (`` **`Gate: owner`** ``);
 *  · ✅ — the gate is recorded as cleared, and the entry is parked (or not) by something else;
 *  · a struck-through line — superseded, kept for the record.
 */
function decoratedField(line) {
  if (line.includes('~~')) return null;
  const m = line.match(/^\s*[-*]\s*\*{0,2}([^\w\s*`~]️?\s*)(Gate|Needs|Verify):/iu);
  if (!m) return null;
  const decoration = m[1].trim();
  if (ALLOWED.has(decoration)) return null;
  return { decoration, field: m[2] };
}

module.exports = { decoratedField, ALLOWED };
