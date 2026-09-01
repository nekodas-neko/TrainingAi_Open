'use strict';
// LA-53. One entry contradicting itself: a body line saying the Lane X half has SHIPPED while the
// entry's own `Lane:` still says X. `next-item.js` reads that field, so the entry keeps heading X's
// READY list long after X has nothing left to do — Q-535 sat at the top of Lane A's for two weeks.
//
// **Only the mechanical case.** BF-64 (filed A; its own recommended fix turned out to be entirely
// client-side) and LA-47 (its proposed split "does not compile") are the same drift and no
// phrase-matcher will ever see them. This one is a comparison between two things already parsed.

const SHIPPED_HALF = /\blane\s+(A|B)\s+half\s+(?:has\s+)?(?:already\s+)?shipped\b/i;

/** A real claim dates itself — the convention is `✅ THE LANE A HALF SHIPPED 2026-08-18`. */
const DATED = /\b(?:19|20)\d{2}\b/;

/** Any entry id, so a line naming a DIFFERENT one can be read as a citation rather than a claim. */
const ENTRY_ID = /\b(?:LA|LB|BF|RV|TN|OR|PS|Q)-\d+[a-z]?\b/gi;

/**
 * The drifted line for an entry, or null.
 *
 * Two exclusions, and both were found by running the rule against the entry that documents it —
 * which reported itself, twice, for two different reasons:
 *   1. **undated prose** describing the shape ("an entry whose Lane A half has shipped keeps…");
 *   2. **a dated citation** of another entry ("Q-535 — Lane A half shipped 2026-08-18").
 * A guard that cannot survive its own documentation is not ready to be enforced.
 */
function laneDrift(id, lane, lines) {
  if (lane !== 'A' && lane !== 'B') return null;
  for (const line of lines) {
    const hit = SHIPPED_HALF.exec(line);
    if (!hit || hit[1].toUpperCase() !== lane) continue;
    if (!DATED.test(line)) continue;
    const cited = (line.match(ENTRY_ID) || []).some((m) => m.toUpperCase() !== id.toUpperCase());
    if (cited) continue;
    return line.trim().replace(/^[-*]\s*/, '');
  }
  return null;
}

module.exports = { laneDrift };
