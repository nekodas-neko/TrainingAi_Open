# 2026-08-25 — the queue tooling learns the `OR-` prefix (PS-6)

**Branch:** `fix/queue-tools-or-prefix` · **Lane B** · two scripts, one new lib, one test. No product
change, no version bump.

The Orchestrator role was created 2026-08-20 and `docs/agents/README.md` §3 lists `OR-` as a valid
entry-ID prefix. **The tooling was never taught the letter**, and it surfaced five days later on the
first `OR-` entry anyone wrote.

## Verified first-hand before fixing, because the failure mode is the interesting part

A scratch `### [platform] OR-99 — …` inserted at the top of the queue:

| | before | after |
|---|---|---|
| `next-item.js` total | **194 with and without it** | 196 with two scratch entries |
| times `OR-99` appears in the output | **0** | 2 |
| duplicate `OR-99` detected | **no** | yes |
| `Needs: OR-98` resolved as a missing target | **no** | yes |

**The total not moving is the whole finding.** `next-item.js` builds an entry only when the heading
yields an id (`current = id ? {…} : null`) and pushes only what it built, so an `OR-` heading was
**dropped from the queue entirely** — not mislabelled, not printed under UNCLASSIFIED, not counted.
An implementer running the tool they are told to start from would never have seen it.

On `check-backlog-pointers.js` the same gap meant duplicate `OR-` ids went undetected and a
`Needs: OR-n` never resolved to a real target — two guarantees that file advertises and, for that one
prefix, did not give.

## The fix is one definition, not four corrected regexes

`scripts/lib/entry-id.js`, beside `lib/lane.js` and `lib/keep.js`, exporting `PREFIXES` plus
`idPattern()` / `idPartsPattern()`. Both scripts import it and no alternation is written out
anywhere else — `grep -n "LA|LB|BF|RV|TN" scripts/*.js` returns nothing.

Four copies of one rule is what let this happen, and `lib/lane.js` already carries the same lesson in
its own comment from the time its rule was duplicated and the copies drifted within a day. Editing
four regexes would have fixed today's letter and left the next one to drift the same way.

**PS-6 named three sites; there are four.** It missed `next-item.js:70`, the `Needs:` matcher — so a
`Needs: OR-n` would have stayed unresolved in the tool even after the three it listed were corrected.

The patterns are built fresh per call rather than shared as module constants: a `/g` regex carries
`lastIndex` between callers, which makes every second `matchAll` on the same object start from the
wrong offset. Pinned in the test.

## Verified

- `scripts/__tests__/backlog-entry-id-prefixes.test.ts` — 14 cases: every prefix in §3, the `a`/`b`
  suffix a same-role collision is resolved with, the three-group split the duplicate detector needs,
  the `/g` state-leak guard, and two negatives (`ORDER-1`, a bare number). **14 passed.**
- Both tools re-run against the real backlog: same 194 entries, same buckets, `check-backlog-pointers`
  OK.
- `pnpm check:rules` **Ran 56 of 56** · eslint clean.

## Not exercised

Nothing device-related — developer tooling. **There is still no real `OR-` entry in the queue** (the
one that exposed this was withdrawn as a duplicate of BF-23 before it merged), so this is verified
against a scratch heading rather than live data. The first real one will be the first live exercise.
