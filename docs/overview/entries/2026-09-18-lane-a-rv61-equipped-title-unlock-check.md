# 2026-09-18 — RV-61: the equipped title was gated on the catalogue, not on having earned it

**Branch:** `lane-a/rv61-equipped-title-unlock-check` · **Lane A** · one PR · no migration · unversioned

## What was wrong

`PATCH /api/user/equipped-title` checked one thing: that the id existed in `TITLES`. Unlock state was
never consulted. The filter that enforces it lives in `components/more/title-picker-sheet.tsx:21`,
which takes `unlockedAchievementIds` as a prop and filters the list — the **client's** copy of a rule
only the server can hold. A direct PATCH skipped it, and the stored value renders on
`friend-leaderboard.tsx`, `friend-feed.tsx` and `app/profile/[userId]/page.tsx`.

Review reproduced it live at sweep 50: a user at `bestStreak: 9` equipped `iron_will`
(`unlockedBy: 'streak_60'`), got a 200, and read it back from Postgres as stored.

## The fix, and why it calls the expensive function

The route now resolves `TITLES[titleId].unlockedBy` and asks `computeAchievements` whether that
achievement is unlocked for the **session** user, refusing with **403** if not.

`computeAchievements` is fifteen parallel queries plus a `reconcileUserStats` write, which is a lot
for a PATCH. **Re-deriving the one rule cheaply here is the thing not to do** — it is the only
implementation of unlock state, read by `/api/achievements` and `/api/profile/[userId]`, and a second
answer that could disagree with the picker is how the client/server split produced this defect in the
first place. Equipping a title is a rare, deliberate, user-initiated action; `/api/achievements`
already runs the same work on every profile paint and carries no rate limit, so the PATCH is not the
cheapest path to abuse and gating it alone would be theatre. **No rate limit added**, matching both
existing callers.

**Clearing a title (`titleId: null`) is not gated and does not call it** — removing a claim is not
making one, and it must not pay fifteen queries.

**400 and 403 stay distinct.** An id outside the catalogue is still a 400, checked first; 403 means
the id is real and the caller has not earned it. The pre-existing `hasOwnProperty` guard (which stops
`constructor`/`__proto__` reaching the column) runs before any unlock work.

## Verified before writing the check

Every one of the 16 `unlockedBy` values in `TITLES` resolves to a real id in `lib/achievements.ts`
(47 achievements). Checked mechanically rather than by eye, because a title whose requirement did not
resolve would now 403 for a user who had genuinely earned it — the failure mode of this fix is
locking someone out, not letting them in.

**Sibling sweep: there is exactly one writer.** `updateEquippedTitle` (`slices/social.ts:97`) is
called only from this route, and `updateUserGoals` — the one generic `users` `.set()` — builds its
object from an explicit key whitelist, so `equipped_title` cannot ride in through a raw body.

## Verification

`app/api/__tests__/rv61-equipped-title-unlock.test.ts`, **12 passing**. Against the route as it
stands on `main`, **4 fail / 8 pass**.

The failing four are the defect and its edges: a locked title refused with nothing written; the
unlocking achievement absent from the list rather than present-and-false (an implementation using
`find(...)!.unlocked` would throw there); an unlocked achievement that merely *shares the title's id*
not satisfying the gate; and the unlock being computed for the session user and timezone.

The eight that pass against the original are deliberate controls — a fix that refused every title
would pass all four failures above, so the suite pins that a legitimately unlocked title still
equips, that clearing still works without touching achievements, that four non-catalogue ids
(including `__proto__` and `constructor`) still 400 before any unlock work, and that an
unauthenticated caller still gets 401.

The `unlockedBy` indirection is asserted in both directions, because an implementation comparing the
achievement id against the **title** id would look correct on the obvious case.

**One pre-existing case changed**, in `lib/__tests__/year-review-and-identity-routes.test.ts`:
*"equips a known title and echoes what was stored"* is now *"equips a known **and unlocked** title"*,
with `computeAchievements` mocked. It was not asserting anything that stopped being true — "known" is
simply no longer sufficient, which is the whole point of the change. Its file header now says so and
points at the new file for the refusals; the other seven title cases there (the null unequip, the
400s, the prototype keys, the 413, the 401) are untouched and still pass.

Gates: `tsc --noEmit` exit 0 · Custom Rules 75 of 75 · `check-test-typecheck` · full suite.

## Not exercised

- **The S25 device.** A server-side authorization check; no UI change, Railway deploy, no APK.
- **A live 403 against production.** The reproduction in the entry was a production *write* by the
  Review sweep; re-running it to confirm the refusal would be another one, so this was verified
  against the route in tests rather than against the deployed instance.
- **Revocation of a title already equipped.** Out of scope deliberately: the gate is on new equips.
  Unlock state is effectively monotonic (`bestStreak` is a best-ever; the counters only fall when
  `reconcileUserStats` heals a delete), so a stored title going un-earned is possible but rare, and
  nothing in the entry asks for it.
- **The owner's own titles.** On a single-owner deployment there may be no adversary at all — the
  entry says as much and rates it low priority on its merits. The reason to do it is that the server
  is the only place the unlock rule can live.
