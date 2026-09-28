# 2026-09-28 — TN-82: the check-in announces its answer, and he corrects it in one tap

**Lane B.** Branch `feat/checkin-announce-and-correct`. v1.480.0.

## What shipped

The morning sheet stops **asking**. Both scales are gone; in their place it states what it filled
and why, and his only interaction is to disagree.

- **`components/checkin/sleep-announcement.tsx`** (new) — the announcement, the five one-tap
  correction chips, and the explicit acknowledgement.
- **`components/checkin/save-sleep-value.ts`** (new) — the one place deciding what gets written and
  whether it counts as his.
- **`components/health/sleep/sleep-verdict-copy.ts`** — `verdictToStoredFeel()`.
- **`components/morning-checkin-sheet.tsx`** — two `ScaleSelector`s out, announcement in, first.

The announcement surface itself already existed: **TN-85 shipped it on Home**, and this reuses its
`verdictCopy()` and its `sleep-verdict:<date>` cache key and TTL rather than introducing a second.

**Why asking had to go, in one line:** 82 morning sheets across three months, and in each month
exactly *one* field collected a handful of answers — always the newly added or newly moved one,
always decaying to zero. `perceived_recovery` has **0 touched answers in 102 check-ins**.

## The three decisions worth not re-litigating

**1. Saving the sheet is NOT an acknowledgement.** The plan wants three states — no response,
acknowledged, corrected — and says a prominent announcement is "prominent enough to be dismissed
deliberately". Treating the **Save** tap as that dismissal would have been the obvious reading and is
wrong: he has saved 82 of 82 sheets while touching a scale in 3, so Save is the reflex, not assent.
Reading it as agreement would manufacture exactly the data the plan forbids — *"data that looks like
agreement and is actually absence"*. Acknowledgement therefore needs an explicit tap on the
announcement, offered only on the prominent one; a quiet line's silence stays recorded as unknown.

**2. The announcement leads the sheet.** `vs_yesterday` was placed first because *"a question placed
after two the owner skips inherits their fate"*. The two it was escaping are gone, and the
announcement is now the thing he is meant to read — the plan's named failure mode (§3) is him not
reading it, so burying it under a question that collected 2 of 82 would be that failure by
construction.

**3. Recovery is written `null`, not a neutral.** It is no longer asked and has no verdict to
announce in its place — there is no recovery model. Null is the honest value for a question not put.

## ⚠ Removing the scales removed an invariant nothing named

`dayCheckinHasAnswers` (Q-465) rejects a check-in body with no answer in it: a **400** on the web
route, and in `pushMutations` a **poison pill with no retry**, which drops the check-in permanently.
Its own header explains why it has never fired in real use —

> *"Both live writers always send at least two numeric scales, because their state initialises from
> `NEUTRAL_SCALES` rather than from null."*

**That is the property this change deletes.** And it cannot be answered by simply not writing a row:
the sheet's auto-open (`session-select-content.tsx`) re-prompts until a row exists for the day, so a
skipped save makes the sheet reappear forever.

So `saveSleepValue` always returns a number — the correction, else the announced verdict, else the
neutral fallback for a day with no verdict (baseline still filling, or the ring has not drained). All
three are untouched unless he corrected, so `answeredMorningScales` nulls every one that is not his.
The unit test calls `dayCheckinHasAnswers` directly on the result rather than describing the rule.

## Verified

- **`components/checkin/__tests__/save-sleep-value.test.ts`** — 7 tests: the hard constraint (only a
  correction is touched), the numeric invariant against the real `dayCheckinHasAnswers`, invisibility
  to readers via the real `answeredMorningScales`, and the verdict ordering asserted as an ordering
  rather than as literals, so an inversion that still type-checks fails.
- **`e2e/tn82-checkin-announce-and-correct.spec.ts`** — 5 tests at 384 px dark, asserting the **POST
  body**: the two scales are absent, the reason is stated with its numbers, an untouched save writes
  `sleepQualityFeel: 4, touched: false` with `perceivedRecovery: null`, and one tap on *Great* writes
  `1, touched: true`.
- **Control-run five ways, each mutation asserted as applied.** Unit: auto-fill sets `touched: true`
  → *"an announcement he never answered must not read as a self-report"*; the fallback returns null →
  the `dayCheckinHasAnswers` assertion fails; the mapping inverted → the ordering fails. E2E: the
  sheet reverted to `main` → *"the sleep scale is still being asked"*; auto-fill touched →
  *"an auto-fill flagged itself as HIS answer — this is TN-57"*.
- Rendered at 384 px dark: *"Slept 5h10, 1h20 short of your usual. Marked this a poor night."*, five
  chips, *That's right*.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

## The bug the e2e caught that no review would have

The verdict fetch was placed in the sheet's existing init effect, which lists `loaded` in its deps
and **ends by setting it** — so it tears itself down and re-runs once per open, and its cleanup flips
the `cancelled` flag the first run's callbacks close over. Harmless for state set synchronously,
fatal for a network read: the fetch resolved, found `cancelled` true, and dropped the answer. **The
sheet then showed no announcement at all, which is indistinguishable from a night with nothing to
say.** It now has its own effect keyed on `[open, tz]`.

## Not exercised

**Not device-verified, and the sheet is the canonical daily surface.** The local store is on its
write path and `getLocalStore` returns null in the web sandbox, so every run above took the **API
fallback** — the local-first save, and therefore the offline correction, has not executed once. A
Known-Issues row records what a device pass owes. The copy is `TN-84`'s (`Lane: O`) and is not
settled: this ships `verdictCopy()`'s existing wording, which is what the owner approved the *shape*
of, not the sentence.
