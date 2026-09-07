# 2026-09-07 — capping the primaries a generated session gets (BF-126)

**Branch:** `fix/generated-session-role-counts` · **Lane A**

## The gap, which is real and verifiable in the code

`/api/generate-program` and `/api/builder-chat` both ask the model for an `exerciseRole` per
exercise, then **enforce the progression style from that role** and never fall back to the model's
own style choice (`generate-program/route.ts:428`, `builder-chat/route.ts:237`). So the role the
model returns picks the percentages and the set count — it is a prescription. Nothing checked it: no
prompt rule caps any role, and rule 6's compound:isolation split is advisory prose to the model.

CLAUDE.md's AI defaults already require the opposite: *structure a model returns is checked in code
rather than trusted*.

## What the measurement changed about the fix

The entry said to confirm the shape against more than one sample before choosing the rule, because
*"a rule fitted to a single roll is how a legitimate 2-compound Pull day gets forbidden."* That was
the right warning, and it caught a wrong rule.

**The owner's own 22 program sessions:** 18 carry exactly one primary. The four that do not are one
legacy program that marked every exercise primary (6/6/5), and one session with zero. But
**secondaries vary 0–3, and two per session is his normal in 10 of them.** A "at most one secondary"
rule would demote what he actually keeps.

**44 generated sessions** (10 programs, powerbuilding and strength, 4- and 5-exercise budgets, 4-
and 5-day splits): **every single one came back with exactly one primary**, and the heavy count was
constant across every program. The defect did not reproduce once.

So the shipped rule is narrow: **at most one primary, extras demoted to `secondary`. Secondaries
uncapped. Never promotes, never reorders.**

## Honest status: this is a guard, not an observed fix

The owner saw a bad distribution once. I could not reproduce it in 44 sessions, including four
programs at his exact reported configuration (5-day, 4 exercises). The model complies today. What
justifies shipping anyway is that **nothing in code would catch it if the model stopped complying** —
a prompt edit or a model change would put a second heavy exercise into his program silently, and the
role is a load prescription rather than a badge. The cap was a verified no-op on 12 further
generations run after the change, with the styles unchanged.

The entry's other half was already retracted by the owner before this session (*"that order is how I
want it!"* — a lighter compound before the main lift is deliberate), so nothing sorts.

## A confirmation that the narrow scope is right

Asked to *"Make Upper Push heavier"*, `builder-chat` responded by moving an accessory up to
**secondary** (P1 S3 A1), not by adding a second primary. A secondary cap would have blocked a
legitimate user request outright.

## Where it lives

`capPrimariesPerSession` in `packages/shared/src/workout/exercise-role.ts` — beside
`recommendExerciseRole`, which already carries the "a wrong role is a wrong prescription" reasoning
for the Coach-swap case (Q-405). Both routes call it **before** the role is read, and in
`builder-chat` **after** the unknown-name filter, so a dropped hallucination cannot spend the
session's one primary. The module had no `docs/module-map.md` row at all; it has one now.

## Verification

- Mutation-tested four ways: no-op, demote-to-accessory, keep-the-last-primary, and cap-secondaries.
  **The cap-secondaries mutation initially survived** — demoting a secondary *to* secondary is
  invisible — so the suite gained the case that exposes it: a secondary *before* the primary, which
  is the owner's own ordering. All four now fail the suite.
- Full suite **6673 passed | 86 skipped**; `tsc` clean; test-typecheck at baseline; Custom Rules
  **68 of 68**.
- `pnpm dev`, authenticated, both routes: three fresh programs (12 sessions) unchanged at 1/2/2 with
  correct styles, and one `builder-chat` edit turn returning 200.

**Not exercised:** the S25. Server-side generation reached through the WebView with no native path,
so a Railway deploy delivers it, but the builder screens were not opened on device.
