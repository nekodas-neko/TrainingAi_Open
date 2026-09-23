# 2026-09-23 — LB-133: the guard for the post-push class could not see the class

**Branch:** `fix/lb133-post-push-guard-blind-spot` · **Lane B** · v1.465.17

## What was wrong

`scripts/check-invalidate-after-push.js` runs as Custom Rules step 37 and printed
`no write invalidates around its push` for the whole time five live sites carried exactly that
defect. It had no baseline and no allowlist, so the clean line read as proof rather than as an
unmeasured claim. Reverting a fixed site and re-running still reported clean — it was blind to the
shape, not to a formatting variant.

The cause was `WINDOW = 12`: a ±12-line text window around the `pushMutations` call. The five sites
LB-132 fixed sit 14, 26, 35, 39 and 53 lines from their invalidation.

## The measurement

The five real pre-fix sources were recovered from git (`git show 66c04c3fdf0:<path>`) and run
through both detectors, because #1467 had already removed every live offender:

| | old detector | new detector |
|---|---|---|
| five real pre-fix sources | **missed all five** | caught all five, at their exact lines |
| the same files after the fix | clean | clean |

## Why the scope is the handler

Widening the window was never an option — that fix already failed once. LB-6 looked only at the six
lines *above* each call, missed five written below, and the window became ±12 both ways, which is how
it reached the state above. A larger number catches today's five, misses the sixth, and starts
matching an unrelated `invalidate*` in a neighbouring function.

Brace-matching the immediately-enclosing block is not enough either: three of the five put the push
and the invalidation in *different* blocks of one handler — two sibling async IIFEs, or a nested
`try` and its parent. So the scope is the function block just inside the component/hook body. Wide
enough to span those siblings, narrow enough that an unrelated handler in the same file is out of
scope. `app/more/more-content.tsx` is the case that proves the second half matters: it holds an
`invalidate*` call **and** a bare push, in different handlers, and is correctly clean.

## It found a sixth offender immediately

`lib/home/rest-day.ts:65`, fixed in the same PR. `chooseRestDay` queued the mutation, fired a bare
`pushMutations`, then `await`ed `invalidateRestDayChoice()` — which clears `next-session`,
`next-session-prescription` and `collection`, all server-computed, and the file's own docblock says
`getNextSession` prefers the stored `rest_days` row. The recomputed recommendation only arrives once
the push lands. **The old scanner never looked at `lib/` at all**; the new one scans it, taking the
file count from 945 to 1,224.

**Lane call (structural, mine):** `lib/home/rest-day.ts` appears in neither lane's path list. It is
reached only from `app/**` and `components/**`, so §3's rule puts it in B. Reversal cost is nil — a
three-line change in one file.

## Verification

- `scripts/__tests__/invalidate-after-push.test.ts` — ten cases, written as **shapes rather than
  distances** and taken from the real pre-fix sources: the far-below invalidation, the sibling
  IIFEs, the nested try, the module-scope helper, and five that must NOT be flagged (two handlers, a
  bare flush, an awaited push, a `.then` chain, the import line).
- Control: the old detector run against all five real pre-fix sources missed every one.
- `tsc --noEmit` clean · `check-test-typecheck` at baseline (320/90) · lint clean ·
  `pnpm check:rules` **Ran 77 of 77** · full vitest suite green.

## Not exercised

The rest-day fix changes when an invalidation fires on the device; the sandbox can prove the call is
present and cannot watch an eviction on a phone. Also not exercised: native SQLite, safe-area,
Samsung WebView, drifted prod data. **Owed:** the rest-day device look, folded into LB-132's pass.

## Also in this PR

LB-129 gained a ruling-out rather than a fix: the back-dismiss machinery **cannot** be the cause of
the day-review sheet failing to open on a cold flip, even though `sheet-back-stack.ts` carries a
documented bug where *"the dialog closed on the frame it opened"*. `handlePop` only runs on a
`popstate`, and `tab-shell.tsx:103` navigates with `replaceState`, which does not emit one. The
entry's claim that `<EndOfDayReview>` renders unconditionally was also re-checked and holds. That
leaves the nested `dynamic({ ssr: false })` chunk as the only live hypothesis.

## Also found here — `main` was red, and the merge call did not stop it (LB-134)

Running the full suite for this change surfaced
`app/api/next-session/prescription/__tests__/prescription.test.ts` failing 4 of 6 **on `main`** —
reproduced in a clean worktree at `main`'s HEAD, byte-identical to GitHub's copy (so not a stale
checkout), and unchanged with `DATABASE_URL` unset (so not environmental).

**Cause:** #1466 (RV-82) changed the route to read `recommendation.program`, since `getNextSession`
already fetches it. The test still stubbed `getActiveProgram` and its `getNextSession` mock had no
`program` field, so `program` was null and **every case fell into the rest-day branch** — including
the two that still reported green. *"Never calls a prescription-mutating repo method"* was passing
**vacuously**, because that branch returns before any of them are reachable.

Fixed here rather than handed over, because a red `main` blocks every lane. The program moves onto
the `getNextSession` mock to match `NextSessionRecommendation`, and one added assertion pins RV-82's
actual point — the route must not fetch the program twice — so the stub cannot go stale in silence
again. The entry is filed `Lane: A`, whose file it is.

**The part that matters more than the test.** The failing `Tests` job did not block the merge:
#1467 was squash-merged at 10:18 while `Tests` was failing on its head (`efb8ee295e6`, run
35847259425), and `merge_pull_request` returned success. **`main` took a red commit.**

That falsifies a rule this repo leans on: *"attempting the merge is the reliable green test … it
cannot merge a genuinely pending check."* It can. The likely reason is already recorded elsewhere in
CLAUDE.md — `enable_pr_auto_merge` fails here with *"Protected branch rules not configured for this
branch"* — meaning required checks are not actually enforced, which makes every "it merged,
therefore it was green" inference unsound. Branch-protection configuration is the owner's call, not
a lane's; until it is settled, read the `Tests` conclusion before merging.
