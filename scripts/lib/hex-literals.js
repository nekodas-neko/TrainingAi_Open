'use strict';
//
// #2652. How `check-hex-literals` counts a hex colour, kept apart from the script so the rule can be
// tested without running the whole walk.
//
// The expression is still the one CLAUDE.md and the 2026-08-14 review used, so a count can be
// reproduced from a shell (`grep -rhoE '#[0-9a-fA-F]{3,8}\b'`). Two things are taken out of it:
//
//  1. Comments, by the caller (`stripComments`): `// see #2383`, a block comment and a JSDoc all go.
//     Strings and template literals stay, so `'#ff0000'`, `bg-[#abc]` and `style={{ color: '#123456' }}`
//     are still counted, and a `//` inside a URL string does not blank the code after it.
//  2. An issue number written where a colour cannot be: a test name (`it('keeps it (#2383)')`) or
//     JSX text (`<p>see #2383</p>`). Those are not comments, so the stripper keeps them.
//
// The second rule is deliberately narrow, because the ratchet is about colours in code: only a match
// that is ALL digits and at least FOUR of them (`#2383`; a PR reference, never a colour a person
// writes; `#919` and `#333` stay counted) AND that does not sit where a colour value sits. A colour
// value sits straight after an opening quote or backtick (`'#1234'`), `[` (`bg-[#1234]`), `:`, `,`
// (`linear-gradient(red, #1234)`) or the `(` of a function call (`linear-gradient(#1234, red)`). A
// reference sits after a word and a space (`item #2383`) or after a spaced `(` (`thing (#2383)`).
// Counts can only go DOWN against the old expression, never up.

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

// What may stand in front of a colour value: quote, backtick, `[`, `:` or `,` (spaces between are
// fine), or a `(` glued to a function name.
const COLOUR_LEAD = /(?:["'`\[]|[:,]\s*|[\w-]\()$/;

function isIssueReference(src, index, match) {
  if (!/^#\d{4,}$/.test(match)) return false;
  return !COLOUR_LEAD.test(src.slice(Math.max(0, index - 8), index));
}

/** Hex colour literals in `src`. Pass comment-stripped source; see the header for what is left out. */
function countHexLiterals(src) {
  let n = 0;
  for (const m of src.matchAll(HEX)) {
    if (!isIssueReference(src, m.index, m[0])) n += 1;
  }
  return n;
}

module.exports = { HEX, countHexLiterals };
