# RV-183 — the last half, and the three writers found while proving it

**Branch:** `fix/rv183-user-profile-fresh-within-ttl` · **Version:** 1.482.1

RV-183's remaining item was one line: put `freshWithinTtl: true` on `more-user-profile` once `LB-180`
removed the `workoutCount` derivation from `/api/user/profile`. LB-180 has shipped — the route is a
pure read of one users row and `user-account-routes.test.ts` asserts the field is gone.

**The entry said "its proof is otherwise complete now — the writer gap is closed". That was wrong,
and writing the proof out is what showed it.**

## Three writers of the users row that cleared nothing

The payload spreads the **whole** users row, so every one of the eleven `update(s.users)` sites is a
writer of this key. Nine were covered. Three were not, each updating local state and nothing else:

| Writer | Column | Why it hid |
|---|---|---|
| `handleGoalsRemindLater` (`session-select-content.tsx`) | `last_goal_review_at` | **The same screen reads it back** to decide whether to re-prompt. The optimistic local write covers this mount only. |
| The password save (`edit-profile-sheet.tsx`) | `password_hash` → `hasPassword` | **That sheet reads this key itself.** A stale `false` re-offers "set a password" and stops asking for the current one. |
| `patchServer` (`lib/user/preferences-sync.ts`) | `preferences` | Nothing reads the bag back through this key today — which is exactly why it would be missed. |

All three are invisible while the key always revalidates. That is the point: the flag is what turns
a stale flash into up to 30 minutes of hard staleness, so the audit has to happen *before* it, not
after a bug report. It is the same shape as the equipped-title writer the earlier half of RV-183
found, and it is the third time this entry has turned one up.

The other two of the eleven cannot go stale here and are recorded at the call site rather than
"fixed": `friendCode` is generated inside `upsertUser` at sign-in and returned by that same call, and
`isActive` is an admin action on another account.

## And one bug I introduced and caught

The preferences fix was first written `void invalidateUserProfile()`. `pnpm test` passed 9,500 tests
and **exited 1 with 7 unhandled `ReferenceError: sessionStorage is not defined` rejections** — the
call sits inside a `.then` with no handler above it, and the cache layer throws outside a browser.
LB-168 documents a "`pnpm test` exits 1 with zero failures" flake, and attributing it to that would
have been the easy and wrong read; the error count went to zero with a `.catch`.

## Verified

- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **952 files, 9,500 passed, 0 errors, exit 0** · `pnpm build`.
- `e2e/profile-details-consolidation.spec.ts` + `profile-group-labelling.spec.ts` — **7 passing**,
  including *a name typed here persists*, which is the PATCH → invalidate → re-read path most at
  risk from the flag.
- **The four new assertions were each proved able to fail** against `origin/main`: all three files
  have zero `invalidateUserProfile()` calls there, and the profile slice has no `freshWithinTtl`.

## Two tests asserted the flag was ABSENT, and both were inverted

`rv183-more-seasons-ttl.test.ts` and `rv183-local-first-reminders.test.ts` each guarded "not eligible
yet — see LB-180". Inverting them is the point of the change, not a test being bent to fit: the
condition they guarded is resolved, and both now assert the flag is present, with the three writer
guards added beside them so a new writer fails CI rather than surfacing as staleness.

## Not exercised

- **The staleness window itself.** Nothing here waits 30 minutes to confirm a cached paint is served
  without a GET; the flag's behaviour is `cachedFetchCore`'s and is covered by its own tests.
- **The device.** No native, safe-area or gesture change. The three fixed writers are all reachable
  in the browser and were exercised there.
