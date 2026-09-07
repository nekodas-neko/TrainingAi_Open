## 2026-09-07 — Which checks needed a comment stripper is now measured, and the answer had already cost something (LA-72)

**Branch:** `fix/check-comment-blindness` · **Lane A**

### What shipped

`scripts/__tests__/check-comment-blindness.test.ts` — a harness that **measures** comment-blindness
per check instead of judging it by reading, plus the 11 conversions it found were needed.

LA-72 said ~30 checks read `.ts`/`.tsx` with no stripper and "nobody knows which need to", and that
a blanket conversion is wrong because some legitimately read prose. Both halves are right, and the
way out is not to read 44 scripts: for each check, run it clean, run it with its banned construct as
**real code**, then with the same construct inside a **comment**.

### The positive control is the whole trick

Without it, "the comment changed nothing" is indistinguishable from "this check never looked at that
file" — and that reading is what makes the whole pass wrong. It bit twice while the harness was
being written: `check-client-today-timezone` and `check-date-param-regex` both first read as
*strips*, because the fixture went into a file neither one scans. `check-date-param-regex` is in
fact blind; the fix was to put the fixture in an API route and require the uncommented case to
change the output before the commented case proves anything.

**Result: 11 of 12 probed checks counted their banned pattern inside a comment.** The twelfth,
`check-client-today-timezone`, is one of LA-64's eight and is the harness's negative control.

### The payoff, which was not theoretical

`check-hex-literals` carried **eight baseline rows for files whose only "hex literal" was a PR
number in a comment** — `(#919)` in `log-activity-sheet.tsx`, `#185` in `hr-day-chart.tsx`, and six
more. Every one of those files held an allowance for a colour it does not contain, so a real hex
literal could have been added to any of them and the theme-token ratchet would have reported clean.
That is the silent direction LA-64 named, sitting in the baseline, found by running the harness
rather than by inspection. The eight rows are deleted.

### One defect this PR caught in itself

The first draft wrote `'app/api/user/goals/route.ts'` as a fixture path — and
`check-route-test-coverage` counts a route covered when a test file contains the literal
`app/api/<route>/route`. So this file, which never calls the goals handler, registered as that
route's test and the ratchet offered to drop its baseline to 144. **That is the same "a mention
counts as a test" defect the ratchet exists to measure, committed in the PR that added a scanner for
it** — the third time this session that the fix and the bug have been the same shape. The paths are
joined rather than spelled out, with the reason in the file, and the baseline stays at the truthful
145.

### Verification

- `pnpm check:rules` — **Ran 69 of 69**. `pnpm build` and `check-test-typecheck` both exit 0.
- **Mutation-checked two ways.** Reverting one converted stripper (`check-api-no-store`) fails its
  case; replacing a fixture with one that cannot trigger its check fails on the **positive control**
  rather than passing — which is what proves the control is load-bearing and not decoration.
- The harness appends to two real source files and restores them in `finally`. No other spec reads
  either path from disk (checked), and the only other test that shells out to a rule runs
  `run-custom-rules.js --list`, which scans nothing.

**Not exercised:** the ~30 remaining unstripped checks are unclassified — this pass fixtured 12. The
harness is the mechanism for the rest, and adding a case is a three-line row. Two known limits carry
over: `strip-comments.js` still mis-reads a regex literal containing a quote, and its `//` rule
would blank an unquoted CSS `url(https://…)` — there are none in `app/globals.css` today, which is
why `check-color-mix-hue` could be converted, but that is a fact about the file, not a guarantee.

No version bump: CI tooling only.
