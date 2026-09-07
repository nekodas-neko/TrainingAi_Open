'use strict';
//
// LA-64: a source-scanning rule that reads prose is checking the wrong file, and the costly
// direction is the FALSE NEGATIVE — `check-icon-button-names.js`'s companion scan reported CLEAN
// against a fully reverted fix, because its pattern matched the word `routeErrorResponse` in the
// fix's own comment. A rule that matches a comment inside the file it is checking passes over code
// it never looked at.
//
// The answer is not to ban quoting the banned pattern in a comment: the explanation is what stops
// the next person reintroducing the thing. Strip the comments before matching.
//
// Eight scripts had grown their own copy of this. Six were byte-identical regex pairs and two were
// worse — `check-render-process-recovery` collapsed each comment to a single space, destroying the
// line numbers its failures are reported with. **But the six-copy version carried the same defect
// class it exists to catch**, so it is not what was extracted: its `//` rule fires inside string
// literals, so `const s = "a // b"; banned()` blanked the call after the string. That is a false
// negative in a check whose whole purpose is to find one — measured, not theorised.
//
// Hence a scanner rather than a regex pair: string literals are copied through untouched, and only
// a `//` or `/*` found outside one opens a comment. That also settles the URL case the old guard
// only half-handled: `(^|[^:])` protected the `//` in `https://` but not a second one later in the
// same URL, so `"https://example.com//a"` lost everything after `.com`.
//
// **Known limit:** a regex literal containing a quote character (`/["]/`) reads as a string opener.
// Rare, and it was equally wrong in all eight copies; a real fix needs a JS lexer, which is more
// than any of these checks are worth.

/**
 * Blanks out `//` and slash-star comments, preserving every newline and the byte length of each
 * line — so a line number computed on the result still points at the right source line.
 *
 * String literals are deliberately kept: a banned identifier inside a raw `sql` template is a real
 * hit, not prose, which is the point `check-learning-mode-isolation` makes in its own comment.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < n) {
        if (src[i] === '\\' && i + 1 < n) { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        const ch = src[i];
        i += 1;
        if (ch === c) break;
        // An unterminated quote must not swallow the rest of the file. A newline ends `'` and `"`
        // (it is invalid JS past that point anyway); a backtick legitimately spans lines.
        if (c !== '`' && ch === '\n') break;
      }
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i += 1) out += src[i] === '\n' ? '\n' : ' ';
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

module.exports = { stripComments };
