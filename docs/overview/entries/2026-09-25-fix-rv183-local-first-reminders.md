# 2026-09-25 — RV-183: a reminder scheduled from the server for a domain the device owns

**Branch:** `fix/rv183-local-first-reminders` · **Lane B** (LB-147)

RV-183 counts requests the client sends for data it already has. Working it found one real
correctness bug, one false comment, and one claim that is wrong.

## The correctness bug, which the entry framed as waste

`sync-provider.tsx` reconciled supplement reminder notifications from `/api/supplements`, on every
launch and every resume. Supplements are CLAUDE.md's **named reference pattern** for offline-first:
the on-device store is the source of truth and the API is backup plus cross-device sync. So the
reconciler was scheduling notifications from whatever had synced.

**A supplement added or stopped offline scheduled the wrong reminder until the next pull.** The
entry saw this as two wasted GETs — "two of them are local-first domains whose data is already on
the device" — and the waste is real, but the reason it matters is that the two sources can disagree
and the device is the one that is right.

It now reads the local store first. The API stays as the fallback: `getLocalStore` returns null on
the web and whenever the store failed to open, and an empty local table is indistinguishable from an
unhydrated one, so both fall through rather than reconciling against nothing and cancelling live
reminders.

**The mapping was extracted, not copied.** `lib/supplements/local-status.ts` now holds the single
local→`SupplementWithStatus` mapping, used by `useSupplements` and the reconcile. Writing a second
one is exactly BF-112, where the inline copy dropped the dose fields, so a dose prompt worked in the
browser — where `getLocalStore` is null and the server's mapping is used — and never fired on the
APK. That failure is invisible off-device, which is why the extraction is not optional.

## The claim that is wrong

The entry says the exercise catalogue (~113 KB) is *"refetched and re-cached on every Workout tab
show"*, citing 3,040 server reads of the table.

It is not. `workout-select-content.tsx:176` passes **`freshWithinTtl: true`** with `TTL_LONG` (6 h),
and `cachedFetchCore` returns before any network call when the entry is fresh
(`lib/sqlite/cache.ts:306`). The flag has been there since the initial snapshot, and
`invalidateExerciseLibrary` — the key's only invalidator — fires on catalogue edits alone. The
ceiling is about four fetches a day per device.

The 3,040 reads are real; they are that ceiling across many days and cold starts. **A read count
localises nothing on its own**, and the entry now says so rather than leaving a future session to
"fix" a path that is already correct.

## The false comment

`more-content.tsx` claimed *"cachedFetch honours TTL_MEDIUM, so a re-show inside the window costs
nothing"*. The TTL governs whether the cached **paint** is used, never whether the request is sent —
only `freshWithinTtl` skips the round trip, and neither call passes it. So a re-show did send two
GETs, as the entry said. The comment now says what is true.

**The requests themselves stay.** Making the comment true instead would mean adding `freshWithinTtl`
to `more-user-profile` and `more-seasons`, and CLAUDE.md requires a written invalidation proof for
that — every write that changes either payload, shown to be in a group that clears the key. A missed
writer turns a brief stale paint into hours of hard staleness on the screen that shows who you are.
That proof is not written, so the flag is not added.

## Verification

7 tests in `lib/supplements/__tests__/rv183-local-first-reminders.test.ts`: the mapping keeps the
dose fields BF-112 lost, marks only what was logged today, stamps the caller's userId, and is the
only copy; the reconcile reads the device first and keeps its fallback. **Control run:** with the
call sites reverted, 3 of 7 fail.

`pnpm lint` clean · `tsc --noEmit` clean · 131 tests pass across the touched suites.

**Not exercised: the device, which is where this one actually lives.** `getLocalStore` returns null
in the web harness, so every assertion here is about source and about the mapping in isolation — the
local branch itself never runs outside the APK. The behaviour that changed is offline behaviour on a
native build, and nothing in this sandbox can reach it.

## Left open

The food-log/meal-types pair on the same reconcile has the same local-first argument, but
`reconcileMealReminders` needs a join this PR did not build. The three fetches duplicating Home's,
`next-session`, and the Lane A halves (`push-then-revalidate.ts`, `cache-groups.ts`, the 2N+1
post-write round) are untouched. RV-183 stays queued with all of it named.
