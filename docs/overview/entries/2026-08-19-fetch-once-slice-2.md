# 2026-08-19 — Q-359 slice 2: four more files, and the last easy ones

**Branch:** `chore/adopt-use-cached-value` · **Lane B** · v1.325.7

Second slice of the fetch-once sweep. **Four files, four sites, 29 → 25**, and the can-bite group
falls from 12 to **8**.

| file | key | mounted by |
|---|---|---|
| `components/health/training-stress-line.tsx` | `training-stress` | Health, via training-load-card |
| `components/activity/exercise-review-sheet.tsx` | `hr-profile` | Home, with a null `sessionId` |
| `components/activity/activity-detail-sheet.tsx` | `hr-profile` | Health, with a null `log` |
| `app/workout-select/workout-select-content.tsx` | `muscle-recovery` | `/workout-select` |

`training-stress-line` is the first real use of slice 1's `today` option — `training-stress` is a
date-less today key, warmed `today: true` and read that way by the done-screen badge, so this is
exactly the site that could not have adopted the hook before the option existed. The agreement test
proves it both ways: dropping the flag fails with *"reads 'training-stress' with today: false, warm
list says true"*, and adding a spurious one to `weights-summary` fails the mirror.

Both sheets carry the same shared `hr-profile` key, and the conversion is load-bearing there rather
than cosmetic: two groups in `lib/cache-groups.ts` call `invalidateCache('hr-profile')`, so the
entry really is cleared by writes and really was never re-read.

## One deliberate behaviour change

`workout-select-content` previously wrote `recoveryMuscles` only `if (d?.muscles?.length)` — so an
empty response left the previous list on screen. The hook writes what the server returned, so an
empty recovery list now renders as empty. That is the honest reading: the old guard preserved a
stale list on a legitimately-empty response, and "keep the last non-empty value" is the shape that
hides exactly the staleness this sweep exists to remove.

## A correction to slice 1's prediction

Slice 1's backlog note said `lib/__tests__/q165-cache-seeded-reads.test.ts` would red when the two
sheets converted, because it asserts `readCacheSync<` and `cachedFetch<` appear literally in them.
**It did not.** Each sheet has *two* fetches and only the `hr-profile` one is a fetch-once site; the
keyed `hr-window:` fetch stays, so both strings survive. It stays green, and the note is corrected in
the backlog rather than left as a wrong prediction for the next session to trip over.

The `hr-window:` fetches are staying for a reason worth recording: their key is per-session
(`hr-window:${query}`) and both sheets are mounted with a **null** prop, so there is no key until one
is selected. `useCachedValue` has no way to express "no key yet" — it always fetches — so those sites
need either a skip/null-key affordance on the hook or to stay as they are. They are not in the
ratchet's baseline (their deps are not `[]`), and the window they describe belongs to a finished
session, so the data is immutable once fetched.

## What is left, and why it is not a fourth slice of the same shape

The remaining 8 can-bite sites are **entirely** in the tab-screen orchestrators:
`session-select-content` (4), `health-content` (2), `nutrition-content` (2). These were left for last
deliberately — each seeds four to eight keys inside one shared `useLayoutEffect` and feeds screen
state that other effects also write, so converting one is a state refactor, not a swap. One file per
PR from here.

## Verification

- `pnpm dev` exercised: Health and `/workout-select`. `hr-profile` 1, `training-stress` 1,
  `muscle-recovery` 2 (warm pass + card, expected — it is in the warm list), the recovery card
  renders, **zero console errors** on both.
- Full unit suite: 4,138 passed. `tsc` clean, lint 0 errors.
- Ratchet 29 → 25, proving itself live on all four files before the baseline was lowered.

**Not verified:**
- **The refetch-on-invalidation half is still not driven end to end.** Same reason as slice 1: both
  vitest projects are `environment: 'node'` with no `@testing-library/react`, and the Home-card E2E
  fixture Q-359 asks for still does not exist.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- The empty-response change above was reasoned from the diff, **not observed** — the local seed has
  muscle-recovery data, so the empty branch was never rendered here.
