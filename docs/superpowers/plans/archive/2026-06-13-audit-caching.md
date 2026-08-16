# Cache Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the stale-cache-after-write gaps so that completing a workout, logging a set, switching programs, and logging mood/body metrics immediately refresh every dependent cached view (currently stale for up to the 6h `TTL_LONG`).

**Architecture:** The client SQLite cache (`lib/sqlite/cache.ts`) is stale-while-revalidate with prefix-based `invalidateCache(prefix)`. The bug class is: a mutation invalidates only its own key, leaving derived summary caches (read by OTHER screens) stale until TTL. Fix = add the missing `invalidateCache()` calls at each write site, grouped into small reusable helpers to keep it DRY.

**Tech Stack:** `lib/sqlite/cache.ts` (`invalidateCache`), React client components.

---

## Findings addressed (mutation → caches that go stale)

| # | Sev | Mutation (file:line) | Caches left stale | 
|---|-----|----------------------|-------------------|
| C1 | **High** | `components/workout-screen.tsx:617` `completeWorkout` | `weekly-stats`, `weights-summary`, `next-session`, `muscle-recovery`, `readiness-score`, `achievements:${userId}` |
| C2 | **High** | `/api/log-exercise` write (workout-screen log path) | `weights-summary`, `weekly-stats`, `muscle-recovery` |
| C3 | **High** | `config-screen.tsx:501` program activate | `next-session`, `muscle-recovery` |
| C4 | **Medium** | `config-screen.tsx` save/delete style (≈232/251) | `progression-styles`, `workout-data` |
| C5 | **Medium** | `config-screen.tsx` delete program (≈524) | `next-session` (only `load()` today) |
| C6 | **Medium** | mood write (`mood-checkin-sheet.tsx:100`), body-metadata writes (`health-content.tsx:379`, `session-select:731/1470`) | `readiness-score` (+ `weekly-stats` for body data) |
| C7 | **Medium** | activity create (`log-activity-sheet.tsx`) / delete (`health-content.tsx:351`) | `weekly-stats`, `achievements`, `muscle-recovery` |

> Note on SWR: because `cachedFetch` always revalidates, the *currently-mounted* screen does eventually self-correct on its own refetch. These gaps bite (a) OTHER screens that don't refetch, and (b) the `readCacheSync` pre-paint flash on next navigation. Invalidation fixes both.

---

## Task 1: Add a grouped cache-invalidation helper

**Files:**
- Modify: `lib/sqlite/cache.ts` (append exported helpers)
- Test: `lib/__tests__/cache-invalidation.test.ts` (new)

Centralize the key groups so the same set isn't duplicated across three call sites (DRY).

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/cache-invalidation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invalidated: string[] = []
vi.mock('@/lib/sqlite/cache', async (orig) => {
  const actual = await orig() as Record<string, unknown>
  return { ...actual, invalidateCache: (k: string) => { invalidated.push(k); return Promise.resolve() } }
})

import { invalidateWorkoutSummaries, invalidateReadinessInputs } from '@/lib/cache-groups'

beforeEach(() => { invalidated.length = 0 })

describe('cache group helpers', () => {
  it('invalidateWorkoutSummaries clears all derived workout caches', async () => {
    await invalidateWorkoutSummaries('user-123')
    expect(invalidated).toEqual(expect.arrayContaining([
      'weekly-stats', 'weights-summary', 'next-session',
      'muscle-recovery', 'readiness-score', 'achievements:user-123',
    ]))
  })
  it('invalidateReadinessInputs clears readiness + weekly', async () => {
    await invalidateReadinessInputs()
    expect(invalidated).toEqual(expect.arrayContaining(['readiness-score', 'weekly-stats']))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test cache-invalidation`
Expected: FAIL — `lib/cache-groups` does not exist.

- [ ] **Step 3: Create the helper module**

Create `lib/cache-groups.ts`:

```ts
import { invalidateCache } from '@/lib/sqlite/cache'

/** Caches that derive from workout/set data — invalidate after completing a workout. */
export async function invalidateWorkoutSummaries(userId?: string): Promise<void> {
  await Promise.all([
    invalidateCache('weekly-stats'),
    invalidateCache('weights-summary'),
    invalidateCache('next-session'),
    invalidateCache('muscle-recovery'),
    invalidateCache('readiness-score'),
    userId ? invalidateCache(`achievements:${userId}`) : Promise.resolve(),
  ])
}

/** Caches that derive from sleep/mood/body inputs — invalidate after those writes. */
export async function invalidateReadinessInputs(): Promise<void> {
  await Promise.all([
    invalidateCache('readiness-score'),
    invalidateCache('weekly-stats'),
  ])
}

/** Caches that derive from program/style structure — invalidate after config edits. */
export async function invalidateProgramStructure(): Promise<void> {
  await Promise.all([
    invalidateCache('workout-data'),
    invalidateCache('next-session'),
    invalidateCache('progression-styles'),
    invalidateCache('muscle-recovery'),
  ])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test cache-invalidation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/cache-groups.ts lib/__tests__/cache-invalidation.test.ts
git commit -m "Add grouped cache-invalidation helpers for derived views"
```

---

## Task 2: Invalidate derived caches on workout completion (C1)

**Files:**
- Modify: `components/workout-screen.tsx:614-624`

- [ ] **Step 1: Import the helper**

At the top of `components/workout-screen.tsx`, alongside the existing `invalidateCache` import (line 24), add:

```ts
import { invalidateWorkoutSummaries } from "@/lib/cache-groups";
```

- [ ] **Step 2: Call it in `completeWorkout`**

In `completeWorkout` (line 614-624), after the existing `invalidateCache('workout-data:meta')` at line 617, add:

```ts
    invalidateCache('workout-data:meta');
    invalidateWorkoutSummaries(user?.id);
```

> Confirm the user id is in scope: `grep -n "user?.id\|user\.id\|props" components/workout-screen.tsx | head`. If the component receives the session/user as a prop or via a hook, use that; otherwise pass `undefined` (the achievements key invalidation is then skipped but the other five still fire).

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "Invalidate derived summary caches when a workout completes"
```

---

## Task 3: Invalidate summary caches after logging a set (C2)

**Files:**
- Modify: `components/workout-screen.tsx` (the set-log success path, near line 145 where `workout-data:${tab}` is already invalidated)

- [ ] **Step 1: Locate the log-set success handler**

Run: `grep -n "log-exercise\|invalidateCache\|handleCompleteSet\|handleLog" components/workout-screen.tsx`
Expected: a handler that POSTs to `/api/log-exercise` and resolves. Identify where the server response is applied.

- [ ] **Step 2: Invalidate the three summary caches after a successful log**

In that success path (after the POST resolves OK), add:

```ts
    invalidateCache('weights-summary');
    invalidateCache('weekly-stats');
    invalidateCache('muscle-recovery');
```

> Do NOT invalidate `next-session` per set — only on program change / workout complete. Keep this to the three set-derived summaries to avoid extra refetch churn during the workout.

- [ ] **Step 3: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add components/workout-screen.tsx
git commit -m "Refresh strength/weekly/recovery caches after logging a set"
```

---

## Task 4: Invalidate `next-session` on program save/activate/delete (C3, C5)

**Files:**
- Modify: `components/config/config-screen.tsx` (save ≈479, activate ≈501, delete ≈524 — verify line numbers)

- [ ] **Step 1: Locate the three handlers**

Run: `grep -n "invalidateCache\|workout-templates\|activate\|deleteProgram\|next-session" components/config/config-screen.tsx`

- [ ] **Step 2: Import and call the structure helper at each site**

Add at top: `import { invalidateProgramStructure } from '@/lib/cache-groups'`

In the program **save** handler, the **activate** handler, and the **delete** handler, replace the ad-hoc `invalidateCache('workout-data')` / `invalidateCache('ta_wc_...')` lines with (keeping any `ta_wc_*` workout-card invalidation that already exists):

```ts
      await invalidateProgramStructure();
```

This guarantees `next-session`, `muscle-recovery`, `progression-styles`, and `workout-data` are all cleared whenever program structure changes — directly fixing the "switching programs shows the old next session" bug.

- [ ] **Step 3: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add components/config/config-screen.tsx
git commit -m "Invalidate next-session and program caches on program save/activate/delete"
```

---

## Task 5: Invalidate program caches on style save/delete (C4)

**Files:**
- Modify: `components/config/config-screen.tsx` (`saveStyle` ≈232, `deleteStyle` ≈251)

- [ ] **Step 1: Locate the style handlers**

Run: `grep -n "saveStyle\|deleteStyle\|progression-styles" components/config/config-screen.tsx`

- [ ] **Step 2: Invalidate after the save/delete resolves**

In both `saveStyle` and `deleteStyle`, after the network call resolves and before/around the existing `await load()`, add:

```ts
      await invalidateCache('progression-styles');
      await invalidateCache('workout-data');
```

(Style pct/reps are embedded in cached `workout-data:*` session payloads, so editing a style must clear them.)

- [ ] **Step 3: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add components/config/config-screen.tsx
git commit -m "Invalidate program-data caches when a progression style changes"
```

---

## Task 6: Invalidate readiness inputs on mood/body/activity writes (C6, C7)

**Files:**
- Modify: `components/profile/mood-checkin-sheet.tsx` (≈100)
- Modify: `app/health/health-content.tsx` (body save ≈379; activity delete ≈351)
- Modify: `components/profile/water-log-sheet.tsx` is already correct — skip
- Modify: the activity log create sheet (`grep` to find: `log-activity-sheet.tsx`)
- Modify: `app/session-select/session-select-content.tsx` (body writes ≈731, 1470)

- [ ] **Step 1: Mood write**

In `mood-checkin-sheet.tsx`, after the existing `invalidateCache('mood:...')`/`mood:` call, add:

```ts
      await invalidateReadinessInputs();
```

(import `invalidateReadinessInputs` from `@/lib/cache-groups`.)

- [ ] **Step 2: Body-metadata writes**

In `health-content.tsx` (after the existing `invalidateCache('body-metadata')` at the save handler) and in both `session-select-content.tsx` body-write sites, add `await invalidateReadinessInputs();` after the existing `body-metadata` invalidation.

- [ ] **Step 3: Activity create + delete**

In the activity-delete handler (`health-content.tsx:351`, after `invalidateCache('activity-logs')`) and the activity-create success path in `log-activity-sheet.tsx`, add:

```ts
      await invalidateCache('weekly-stats');
      await invalidateCache('muscle-recovery');
```

(and `invalidateCache('activity-logs')` in the create path if not already present, plus `invalidateCache('achievements:' + userId)` if the userId is available).

- [ ] **Step 4: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add components/profile/mood-checkin-sheet.tsx app/health/health-content.tsx app/session-select/session-select-content.tsx
git add components/**/log-activity-sheet.tsx
git commit -m "Invalidate readiness/weekly caches on mood, body, and activity writes"
```

---

## Task 7 (optional, Low): dedupe SyncProvider warm vs page fetch

**Files:**
- Modify: `components/sync-provider.tsx:44-48`

`warmCache` uses a raw `fetch`/`setCached` that does not participate in `cachedFetch`'s in-flight lock, so a cold start can fetch the same URL twice (warm + page). Harmless but wasteful.

- [ ] **Step 1:** Route `warmCache`'s fetch through the same in-flight dedupe as `cachedFetch` (export the lock map or a `fetchAndCache(key,url,ttl)` from `lib/sqlite/cache.ts` and call it from both). Only do this if it can be done without widening the cache module's API surface unnecessarily. Otherwise skip — it's a minor cold-start inefficiency.

- [ ] **Step 2: Commit (if changed)**

```bash
git add components/sync-provider.tsx lib/sqlite/cache.ts
git commit -m "Dedupe SyncProvider warm fetches against in-flight cachedFetch requests"
```

---

## Verification before completion (whole plan)

- [ ] Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint` — all PASS.
- [ ] Manual (local DB, `pnpm dev`): log a workout, then navigate to the Profile/Health tabs — XP/level, weekly stats, strength card, and home `next-session`/readiness all reflect the new session immediately (no 5-min/6h lag).
- [ ] Manual: switch active program in config, return home — the "Next Session" card shows the newly-activated program's session, not the old one.
- [ ] Push: `git push -u origin claude/app-comprehensive-audit-goew61`.

## Local testing notes (per CLAUDE.md)
- **Pull:** `git pull origin claude/app-comprehensive-audit-goew61`
- **What to look for:** stale stats after a workout / program switch are gone; home + profile + health update without waiting for TTL.
- **Regression to check:** confirm the active workout screen itself doesn't over-refetch (Task 3 deliberately excludes `next-session` from the per-set path).
