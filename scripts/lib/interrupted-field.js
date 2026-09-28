'use strict';
//
// A field declaration the parser cannot see because words were written between its NAME and its
// COLON.
//
// `decorated-field.js` catches the marker written IN FRONT of a field (`⚠ Gate: owner`). This is
// the same failure from the other side: the bullet opens with the field's name, so it reads to a
// human as a declaration, and then says something before reaching the colon —
// `**Keep / Done when:**`, `**Keep ①, the owner's:**`. Every field matcher anchors the colon
// directly after the name, so all of these parse as nothing at all.
//
// **RV-210 sat at rank 1 of Lane B's READY list because of this.** Its three fixes had shipped and
// its only residue was a device pass, written `- **Keep / Done when:**`. An implementer working the
// queue top-down takes a finished entry first and finds nothing to build — which is exactly the
// starvation the `Keep:` field exists to prevent. Two more (`BF-191`, `BF-188`) were filed the same
// way and sit lower in their lanes.
//
// **The test is the colon inside the bold span, not the extra words.** "Keep" is also an ordinary
// verb, and the backlog legitimately opens bullets with it — `**Keep the model and constrain it
// harder**`, `**Keep the signal, move it.**`. Those state a position; they do not declare a field,
// and they carry no colon inside the bold. The em-dash form `**Keep — three things:**` DOES parse
// today, so it must not be flagged either; that is why the caller passes in whether the parser
// actually saw the field rather than this file guessing.

/** Field names whose matchers all anchor the colon directly after the name. */
const FIELDS = ['Keep', 'Gate', 'Needs', 'Verify', 'Reference'];

/**
 * The field this bullet *looks like* it declares, or null.
 *
 * Matches only when the bullet opens with `**<Field>` and a colon follows inside the same bold
 * span. The caller decides whether that is a failure, by asking the real parser whether the field
 * was read.
 */
function interruptedField(line) {
  const m = line.match(/^\s*[-*]\s*\*\*(Keep|Gate|Needs|Verify|Reference)\b([^*]*?):/);
  if (!m) return null;
  const between = m[2].trim();
  // Nothing between name and colon is the CORRECT form — that one parses, so it is never a failure.
  if (between === '') return null;
  // **Every one of these names is also an ordinary verb**, and the backlog uses them that way with a
  // trailing colon: `**Needs hardware the agent does not have (~5):**` introduces a list, it does
  // not declare a dependency. A verb is followed by its object — a lowercase word — while a field
  // someone interrupted carries punctuation or an enumerator first (`/ Done when`, `①, the owner's`).
  // That is the separation, and it was found by running the check: the first version flagged RV-143.
  if (/^[a-z]/.test(between)) return null;
  return { field: m[1], between };
}

module.exports = { interruptedField, FIELDS };
