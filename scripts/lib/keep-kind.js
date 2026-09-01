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

module.exports = { keepKind, CHECK, BUILD };
