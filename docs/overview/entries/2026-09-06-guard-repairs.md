# Seven guards that fired on the textbook shape and missed the common one (PS-34)

**Branch:** `fix/ps34-guard-repairs` · **Lane:** A · **Domain:** platform

Every one of these rules passed. That was the problem: each was written against one example and
pinned an incidental of it, so the shapes people actually write fell outside and the run reported
green over code it had never read.

## The correction that matters most

**PS-34 says "no live violation exists behind any of them today (re-scans with widened patterns:
0 hits)". That is wrong.** Widening the icon-button scan surfaced **eighteen** live accessibility
defects — icon-only controls announced by a screen reader as "button" and nothing else. Filed as
**LA-62** and frozen shrink-only, because every one is in Lane B's files.

The body-fat widening produced a finding too. That one *is* clean, but only after reading the
caller: `components/profile/goal-baseline.ts` documents its input as already corrected, and
`goals-section.tsx:276` does pass `displayBodyFat(...)`. Exempted with the verification recorded,
not with the comment quoted back.

So the entry's own claim held for five rules of seven. A re-scan that reports zero is worth exactly
as much as the pattern it re-scanned with.

## The seven

1. **PPL session names.** `grep -v 'push\|pull'` dropped any line containing lowercase push or
   pull — and ran *before* the real match. Since the first `grep` already requires the capitalised
   quoted literal, the filter could only ever produce false negatives. Harnessed: a line reading
   `{ name: "Push", sync: "pushMutations" }` was invisible to the old rule and is caught by the new
   one.
2. **Icon-button names.** `(\s[^>]*?)?>` ends the opening tag at the first `>`, which in
   `onClick={() => …}` is the arrow's. Replaced with a walk that tracks brace depth and string
   state. This is the one that had eighteen live findings behind it.
3. **Capacitor plugin proxies.** The import pattern pinned `'` and the return pattern required no
   semicolon. Either variant bound nothing and the file fell out at the "no bindings" guard —
   silently, since that looks exactly like a clean file.
4. **Doc-size ratchet.** `if (lines <= limit) continue` meant the ratchet only pointed one way:
   CLAUDE.md sat **429 lines** under baseline, so the most-read file in the repo could grow by more
   than half its own length with nothing complaining. `verdict()` now returns `'slack'` and three
   stale baselines are lowered to reality.
5. **Test-user UUID collisions.** `git ls-files '*.test.ts'` omits untracked files — so a test
   written this session is invisible to the local gate and only collides in CI, where nobody is
   looking — and omits `.tsx` entirely. Proved with a probe: 777 files before, 778 after.
6. **Vendored constants.** The skip guard covered the directory being *gone*. What happened is that
   it stayed, holding a README and no `.json`, so the skip never fired, the vendor set was empty,
   and the run printed `OK (0 vendor values, no inlined copies)` forever. Zero values is the same
   state as no directory and now gets the same answer.
7. **Body-fat correction.** Never walked `components/`, and `DERIVERS` omitted `calculateBaseline`
   — which `app/api/nutrition-goals/recommend` calls twice, so that route was never examined.

## `verdict()` is shared, and eight other checks call it

Adding `'slack'` changes a function eight other rules use. Audited: every one branches on
`'inherited'` and `'fail'` alone, so `'slack'` falls through to no action exactly as `'ok'` did —
and that is correct, because each already enforces shrink in its own second loop. Written into the
function's doc comment so nobody "finishes the job" and makes them double-report.

## What a baseline is for here

The icon-button baseline freezes debt, but the mutation run showed it does something better:
breaking the brace-aware walk makes files read as **zero** against a non-zero number, and the
shrink-only half fails for that. So the list pins the scanner's *reach*, not just the count. A guard
that goes blind again cannot pass.

## Verification

- `tsc --noEmit` clean · **772 passed | 5 skipped (777 files), 6577 tests** · `pnpm check:rules`
  **68 of 68**
- Three previously-missed shapes added to `plugin-proxy-scan.test.ts`; the `verdict` test updated
  for `'slack'` with the old expectation's reason recorded rather than flipped
- Mutation-verified: reverting the import quoting fails two proxy cases by name; removing `'slack'`
  fails two verdict cases; breaking the brace walk fails the icon-button check
- The PPL and UUID repairs were harnessed against a violating snippet — the only way to show a
  widened grep catches what the old one missed

**Not exercised:** nothing runtime. These are CI scripts and one workflow file; no application code
changed, so there is nothing to see on device and no APK involved.
