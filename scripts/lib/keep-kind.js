'use strict';
//
// What kind of thing a `Keep:` residue actually owes (OR-100).
//
// `next-item.js` prints Keeps under a heading that reads *"shipped; only the stated residue is
// owed. **Not new work**"* — which is true of most of them and false of a few, and the few
// disappear from where implementers look. Measured on Lane B's queue while the Orchestrator was
// answering *"B is still saying there is no work for it"*: of 12 Keeps, five were device checks,
// one an owner call, one said outright "nothing to build" — and **four were builds**, including a
// fully specified UI half whose engine had already shipped. Lane B's real buildable depth was ~13
// against the 9 that READY reported.
//
// This is the `Gate: device` failure one section over, with the same mechanism: a field written to
// mean *"partly done"* is read by the runner as *"do not start"*. The difference is that `Gate:` is
// specified in the backlog's field rules and `Keep:` was documented nowhere until OR-100.
//
// **Advisory on purpose, and it must stay that way until the known cases are split.** OR-100 is
// explicit: start with enforcement off and print a count, or CI goes red on entries nobody has
// triaged. This module classifies; nothing here fails a build.
//
// It reads prose, which is the honest limit: the residue is written as a sentence, not a field.
// `check` wins ties because "the device check, and only that" is unambiguous and is what most of
// them say; `unclear` is a real answer and is reported as such rather than being forced either way.

/** Phrases that name a verification someone must perform — not code anyone can write. */
const CHECK = [
  /\bdevice (check|press|pass|run)\b/i,
  /\bon-device check\b/i,
  /\bS25 check\b/i,
  // The commonest phrasing after "the device check": LB-24's "the press itself, on the S25",
  // BF-27's "the gesture itself, on the S25". Naming the device IS naming a human action.
  /\bon the S25\b/i,
  /\bthe gesture itself\b/i,
  /\bcontrast check\b/i,
  /\bowner'?s call\b/i,
  /\bowner decision\b/i,
  /\bthe owner seeing\b/i,
  /\bis the owner'?s\b/i,
  /\bnot reproduced\b/i,
  /\btwo-phone\b/i,
  /\bverification\b/i,
];

/** Phrases that name something still to be BUILT. */
const BUILD = [
  /\bunbuilt\b/i,
  /\b(is|are) not built\b/i,
  /\bnothing can\b/i,
  /\bno control\b/i,
  /\bthe picker\b/i,
  /\b(back-?fill|redecode)\b/i,
  /\bhalf (is|are|shipped|of)\b/i,
  /\bLane [AB]'?s\b/i,
  /\bstill (owed|unbuilt|missing)\b/i,
];

/**
 * `'check' | 'build' | 'unclear'` for one Keep's residue text.
 *
 * A Keep that states a `Gate:` is a check by construction — the field already says a human has to
 * do something — so callers should prefer the gate and only fall back to this.
 */
function keepKind(text) {
  if (!text) return 'unclear';
  if (CHECK.some((re) => re.test(text))) return 'check';
  if (BUILD.some((re) => re.test(text))) return 'build';
  return 'unclear';
}

/**
 * Has this entry's device check already happened, while its `Keep:` still asks for one?
 *
 * **A FAILED look counts, and missing that was this rule's own blind spot (TN-13, 2026-09-15).**
 * The first version keyed on `VERIFIED` alone, so an entry whose check came back BROKEN went on
 * advertising itself as *"shipped; a look is owed, nothing is blocked"* — which is worse than the
 * case the rule was written for, not better: it is live, buildable work filed as finished. TN-13 sat
 * that way with the wrong lane on it as well, because the lane was chosen for where the entry
 * assumed the defect was rather than where the failing look proved it is.
 *
 * The state nineteen entries were in after three device passes (OR-113, 2026-09-14): the owner's
 * verification was recorded as a `✅ VERIFIED ON THE S25` line and the `Keep:` above it went on
 * claiming the check was owed, so `next-item.js` kept printing finished work as debt. Both halves
 * read correctly on their own, ten lines apart, which is why nobody caught it by reading.
 *
 * A `Keep:` reconciled against a recorded verification says which half is **DONE** — that word is
 * the acknowledgement, and it suppresses this. Without it the rule fires hardest on the entries
 * someone has already narrowed correctly (BF-145, Q-531, Q-187 all did), and an advisory that is
 * wrong as often as it is right gets scrolled past.
 *
 * @param {{ text: string, gate: 'owner'|'device'|null } | null} keep  the parsed `Keep:`
 * @param {string[]} lines  the entry's body
 */
const S25_OUTCOME = /(VERIFIED|FAILED|REPORTED BROKEN) ON THE S25/;

function keepIsSettled(keep, lines) {
  if (!keep) return false;
  const kind = keep.gate ? 'check' : keepKind(keep.text);
  if (kind !== 'check') return false;
  if (!lines.some((l) => S25_OUTCOME.test(l))) return false;
  return !/\bDONE\b/.test(keep.text);
}

module.exports = { keepKind, keepIsSettled, CHECK, BUILD };
