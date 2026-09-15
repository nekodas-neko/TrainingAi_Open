# BF-9 — the trainer role gets a plan, and the plan stops it rebuilding RV-42

**Lane A · branch `lane-a/bf9-trainer-role-plan` · docs only, no code.**

## Why this and not something else

Lane A's queue is, at the time of writing, **entirely blocked on the owner or on another lane**. Nine
READY entries: LA-76 needs the stored-deload-span decision its own entry says to put to the owner;
RV-42 is PR #1098, built, green and owner-gated; Q-220's remaining lever is a bulk docs move (see
below); Q-1a is bearer auth, whose merge sits in the same confirm-first carve-out; Q-29's Task 5 is
device-paired and unverifiable in a sandbox; LA-110's own question is unanswered; Q-28 says in its
own text not to build on the measured number; BF-7's remaining half is Lane B's.

That left BF-9, which is a feature request with **no plan document** and a documented next step of
"a planning session". A planning PR is docs-only, merges with zero ceremony, and reduces the owner's
decision load rather than adding a second gated code PR to it.

## What the plan settles

[`docs/superpowers/plans/2026-09-15-trainer-role.md`](../../superpowers/plans/2026-09-15-trainer-role.md)
— PR 1 (migration, alone) / PR 2 (engine, Lane A) / PR 3 (trainer UI, Lane B).

**The finding worth the session: the cheap version of this feature rebuilds RV-42.** The entry says,
correctly, that `saveProgram(db, userId, program)` is already parameterised by user id, so a trainer
route is "call the same function with a different id". What it does not say is where that breaks.
`app/api/workout-templates/route.ts:74` validates a program's progression styles with
`progressionStyleIdsOwned(userId, …)`, scoped `eq(progressionStyles.userId, userId)`. Aim it at the
trainee and a trainer cannot use one style from their own library. Aim it at the trainer — the
obvious fix, and the one a hurried implementer takes — and the result is a row in one account
pointing at a row in another, with `session_exercises.style_id` on `ON DELETE SET NULL` and the
foreign key as the only ownership link.

That is RV-42's rule (c), in a second domain, **while RV-42's own fix is still sitting unmerged**.

The plan's answer is **copy-on-assign**: copy the referenced style into the trainee's account and
reference the copy, so the trainee owns every row their program depends on and no cross-account edge
exists to guard. The two alternatives are written up with what each is genuinely better at — using
only the trainee's styles needs no new code but makes the feature useless for a new trainee who has
none; allowing the cross-account reference gives the trainer one-place edits and is the bug.

## A stale claim removed

The entry said PR #124 was **"currently open"** and **"awaiting the owner's word since 2026-08-18"**,
and that landing it first was the cheaper order. **#124 merged on 2026-08-23.** Checked against
`main` rather than read off the PR title: `scripts/check-admin-claim-in-api.js` exists, it is wired
into the Custom Rules job, `lib/__tests__/admin-claim-not-authoritative.test.ts` is present, and the
only `isAdminUser(` left under `app/api/**` is the comment recording the fix.

So BF-9's stated prerequisite is discharged. It is blocked only on the owner's word to merge, which
is the whole feature rather than one migration inside it — the migration itself is additive and
reversible and needs no such gate.

## Q-220 deferred, with the reason recorded

Q-220 sat above BF-9 in the queue and was passed over. Its Lever 3 is not a discrete task by its own
terms (*"incrementally, on touch, never as a big-bang rewrite"*), so what is queued is Lever 2 — a
bulk move of ~207 open entries out of the one file five other concurrent agents append to every
session. The failure mode there is not a merge marker but a **silently dropped entry**, the same
shape that resurrected LB-4, Q-454, Q-455 and Q-465 three times from ordinary two-deletion
conflicts; and Lever 1 already showed the specific hazard, with **19 of 72 ✅-marked entries still
owing something**. It wants a quiet window and the Orchestrator's docs authority. Nothing about the
measurement is disputed and the entry stays queued — the reasoning is now written down so the next
implementer does not re-derive it and defer it again silently.

## What is NOT done

No code. No migration number reserved — the plan says to take the next free one at implementation
time precisely because it may sit in the queue while other Lane A migrations land.

## Failure surfaces NOT exercised

Docs only; nothing runs. Every code claim in the plan was read off `main` at `a8a086d793` —
`friendships`' schema and the `addresseeId`-scoped accept at `social.ts:65`, `saveProgram`'s
signature, `progressionStyleIdsOwned`'s scoping, the two `ON DELETE SET NULL` `style_id` columns, and
#124's three artifacts — rather than recalled.
