'use strict';
//
// LA-88 — detecting a `.strict()` that has nothing to act on, in ONE place so the check and its
// test cannot drift (the same reason `lib/lane.js` and `lib/apply-delta-domains.js` exist).
//
// A route that hands its schema an object it built key-by-key has already discarded every unknown
// key before validation runs, so `.strict()` there guards nothing. The discriminator is structural:
// a spread (`{ ...body, id }`) means real request keys reach the schema and strictness fires; an
// all-literal object means it cannot.
//
// **Extracted because the whole-script test could not tell the two guards apart.** Its witness for
// "a spread is excluded" was `running-plan/runs/[id]`, which is excluded TWICE over — it has a
// spread AND its schema is imported, so the file carries no `.strict()` at all. Two mutants
// (dropping the spread test, dropping the `.strict()` precondition) both survived against it. A
// fixture isolates one rule at a time, which a real file rarely does.

/**
 * @param {string} src source with comments already stripped
 * @returns {number} `safeParse` sites whose strictness cannot fire
 */
function countInertStrict(src) {
  if (!/\.\s*strict\s*\(/.test(src)) return 0;
  let n = 0, i = 0;
  while ((i = src.indexOf('.safeParse(', i)) !== -1) {
    let j = i + '.safeParse('.length;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== '{') { i = j; continue; }
    let depth = 0, k = j;
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { k++; break } }
    }
    if (!src.slice(j, k).includes('...')) n++;
    i = k;
  }
  return n;
}

module.exports = { countInertStrict };
