## 2026-09-07 — One comment stripper, and the false negative hiding inside six copies of it (LA-64)

**Branch:** `fix/rules-strip-comments` · **Lane A**

### What was wrong

A source-scanning CI rule that matches its own explanatory comment is checking the wrong file, and
the costly direction is the **false negative**: it reports clean over code it never parsed. That is
how `check-icon-button-names.js`'s companion scan passed against a fully reverted fix — its pattern
matched the word `routeErrorResponse` in the fix's own comment. The noisy direction (an inline grep
flagging a comment that says the module deliberately does *not* use the banned expression, which is
what happened to BF-122a) is only a false positive.

### What shipped

**`scripts/lib/strip-comments.js` — one implementation.** Eight `check-*.js` scripts had grown their
own. Six shared a regex pair; two had drifted, and both were worse — `check-render-process-recovery`
collapsed each comment to a single space, destroying the line numbers its failures are reported
with, and `check-learning-mode-isolation`'s character scanner read the `//` in `https://` as a
comment opener.

**The six-copy version is not what was extracted, because it carried the defect class it exists to
catch.** Its `//` rule fires inside string literals, so `const s = "a // b"; banned();` blanked the
call after the string and the scan saw no violation. Measured, not theorised. The shared version is
a scanner instead: string literals are copied through (a banned identifier inside a raw `sql`
template is a real hit, not prose — the point `check-learning-mode-isolation` makes in its own
comment), and only a `//` or `/*` found outside one opens a comment. That also settles the URL case
the old `(^|[^:])` guard only half-handled — it protected the `//` after the scheme and nothing
after it, so `"https://example.com//a"` lost everything from `.com` onward.

The one known limit is written into the module: a regex literal containing a quote (`/["]/`) reads
as a string opener. Rare, equally wrong in all eight copies, and a real fix needs a JS lexer.

**Ten inline greps in `ci.yml` now filter comment lines** — `^[^:]+:[0-9]+:\s*(//|\*|\{?/\*)`, JSX
comments included. Two already had ad-hoc versions of this filter in two different shapes; both are
now the same expression.

`check-aest-midnight-timezone.js` keeps its own `stripCommentsAndStrings`: it blanks string
literals too, which is a different contract and correct for what it counts.

### Verification

- `scripts/__tests__/strip-comments.test.ts`, 9 cases — the ones that were actually wrong, not a
  general lexer suite. A source-reading case asserts no `check-*.js` declares its own stripper
  again, since eight copies is how two of them drifted.
- **Planted-violation checks on the real gate**, which is the only thing that proves the filters
  work: a file whose *comment* quotes `new Date().toISOString().slice(0, 10)` leaves `No UTC date
  slicing` green, and the same file with that expression as *code* fails it. Same pair for the JSX
  shape on `No pb-safe* stacked` — `{/* className="pb-safe p-4" */}` green, the real className red.
- All seven rewired checks run clean; `pnpm check:rules` — **Ran 68 of 68**, all passed.
- `scripts/__tests__`: 199 passed.

**Not exercised:** nothing device- or runtime-facing — this changes CI tooling only, so there is no
APK or product surface to check. No version bump for the same reason.

### Deliberately not done

**LA-72** — roughly thirty other `check-*.js` scripts read `.ts`/`.tsx` and strip nothing. A blanket
conversion is wrong: several legitimately read prose (`check-claude-md-paths`,
`check-module-map-symbols`) or count raw lines (`check-component-size`), so it needs a per-check
pass rather than a sweep. Its one known carve-out is folded into that entry: `Safe-area utility
classes must be defined` extracts class tokens with `grep -roh`, so its output has no line prefix to
filter — and a class named only in a comment reads as used-but-undefined, which is the loud
direction.

Backlog: LA-64 removed, LA-72 added, baseline lowered 14 with a note. `docs/module-map.md`'s
CI-rules row now names the shared stripper and why the class is a false negative.
