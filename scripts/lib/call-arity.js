'use strict';
//
// Calls to `name(...)` that pass fewer than `minArgs` arguments — the shape that omits a timezone.
//
// Arity is per function and that is the whole reason this exists: the tz is `todayMidnightUtc`'s
// FIRST argument but `toAestDay`'s SECOND, so one rule cannot cover both. Nor can a regex:
// `toAestDay\([^,)]+\)` matches the corrected `toAestDay(new Date(x), tz)` by stopping at the inner
// `)`. So this balances the parentheses and counts the commas that sit at the call's own depth.
//
// Moved here from `lib/__tests__/rv176-timezone-escapes.test.ts` (RV-179), where it was the engine of
// a vitest scan that only the full suite ran; Custom Rules now runs it on every PR.
//
// Pass source with comments already stripped (`lib/strip-comments`): a comment quoting the call is
// not a call. Strings and template literals are not parsed, so a comma or paren inside one of an
// argument's string literals can miscount; no call this repo makes to these helpers has one.

/** The source text of each call to `name` that passes fewer than `minArgs` arguments. */
function callsUnderArity(src, name, minArgs) {
  const hits = [];
  const re = new RegExp(`\\b${name}\\(`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let commas = 0;
    let body = '';
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      else if (c === ',' && depth === 1) commas++;
      body += c;
    }
    const args = body.trim() === '' ? 0 : commas + 1;
    if (args < minArgs) hits.push(src.slice(m.index, i + 1));
  }
  return hits;
}

module.exports = { callsUnderArity };
