# 2026-08-30 — Q-284: the activity blend is dead, and its own verification had hidden that

**Branch:** `chore/retire-oura-activity-blend` · **Lane:** A · **Domain:** activity · devices

## Why this was filed as a decision, and why it should not have been

`blendActivityScore` existed to credit gym training that Oura's Cloud activity score under-counted.
The 2026-08-15 review's first reading was **"dead code — the Cloud is gone, so
`oura_daily.activity_score` is always null."** Verification then *softened* it: production said
`count(activity_score)` over post-re-key days was **1 of 40**, so the entry was re-filed as "nearly
inert, not dead" and turned into a decision — retire it, or document why one day in forty takes a
different code path.

**That one day is 2026-07-07 — the BLE re-key date itself.** Re-measured today: 16 scored rows in
all history, newest `2026-07-07`, and **zero** across the 55 days since. The original count used an
inclusive boundary on the re-key day, so the "1 in 40" was the last Cloud write ever, not an ongoing
trickle.

**And nothing can write another.** The only live writer of `oura_daily` is the BLE rollup's
wear-time step (`run.ts:877`), whose rows are `{ date, nonWearTimeSec }`. `activityScore` is passed
`?? null` and never set. The branch cannot fire again.

So the first reading was right, and the decision the entry asked for does not exist. Deleted.

## What shipped

- `lib/activity/blend-activity.ts` and its test — gone.
- `readiness-payload.ts` builds `activityBlend` directly from our own Activity Score.
- `ActivityBlendResult` moved into `readiness-payload.ts`, which is now its only definer and
  consumer. **The shape is kept rather than collapsed** — it is the payload's published contract and
  `health-score-detail.tsx` reads it. `adjustment` is now structurally `0`.
- `packages/shared/src/health/activity-score.ts` — a comment saying `blend-activity` still scores
  against `typicalSessionVolumeKg` corrected; it does not, and now cannot.

## The follow-up this creates, filed rather than reached for

`health-score-detail.tsx:205` computes `trainingBoostFrom` from `activityBlend.adjustment > 0`,
which can now only take its null arm. That file is Lane B's, so it is **LA-42** rather than an edit
here.

**It is not a regression**, and the distinction is the point: the prop has been dead in practice
since 2026-07-07. Q-284 turned "dead in practice" into "dead by construction", which is what makes
it safe to delete rather than merely unused today. The sibling banner it paired with
(`activity-content.tsx`'s *"Oura 56 · +10 training → 66"*, named in the 2026-07-02 plan) is already
gone — a grep for `.adjustment` across `app/` and `components/` returns that one line and nothing
else.

## Verification

Full suite green, `pnpm check:rules` all steps passed, `tsc --noEmit` clean. `check-dead-repo-methods`
and the doc-link checks both cover the deletion.

**No mutation test, deliberately.** There is nothing left to mutate — the code is deleted, and the
claim being made is an absence. What stands in for it is the production measurement above: newest
scored row, count since, and the enumerated writer. Each is stated so it can be re-run rather than
believed.

**Not exercised:** no device path and no user-visible change — `adjustment` was already 0 on every
day since the re-key, so every screen renders exactly as it did. No version bump.

**Scope of the numbers:** `claude_ro` is row-scoped to one user, so "16 scored rows" is the owner's.
The writer argument is not row-scoped and is what actually closes this.
