# Native Feel Phase 4 — Stop the Health Screen Fetching Three Tabs to Show One

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Health screen's request burst by fetching only the sub-tab the user is actually
looking at, instead of all three on every mount.

**Architecture:** `app/health/health-content.tsx` holds one `fetchAllHealthData` callback that fires
12 `cachedFetch` calls on mount, plus 4 more alongside it, plus 15 self-fetching child components.
None of them consult the `tab` state. The fix is to gate each fetch on the sub-tab that consumes its
data, and to fetch the other two lazily on first activation — the pattern `TabShell` already uses for
the five main tabs.

**Tech Stack:** `app/health/health-content.tsx`, `components/health/*`, `lib/sqlite/cache.ts`.

---

## This plan replaced an earlier one, and the reason matters

**The original Phase 4 targeted the Home tab and was scoped around ~14 requests.** The owner's Phase 0
device measurement showed that was the wrong target:

| Screen | Requests observed on device |
|---|---|
| Workout | 16 |
| Home | 20–28 |
| Nutrition | 28 |
| **Health** | **53–85** |

Health is the outlier by 2–3×. The original plan's premise — a `/api/home-bootstrap` aggregate — is
therefore **withdrawn**; it would have optimised the wrong screen, and an aggregate endpoint is a much
heavier change than simply not fetching data nobody is looking at.

**Also withdrawn: the pool-contention framing.** The original plan reasoned about ~14 concurrent
requests against `max: 10`. On device, every Health call except one returned in **1–6 ms**, and the
single slow one (`stats`, at 1.37–1.60 s) turned out to be a blocking Oura Cloud call, fixed
separately in #885. There is no evidence of pool starvation. **Do not raise `max`** — that is what
caused the session-165 connection-saturation outage.

---

## The measured problem

`app/health/health-content.tsx:110-113` keeps a `tab` state of `'body' | 'training' | 'progress'`,
defaulting to `'training'`. **No fetch effect in the file reads it.** Verified: every effect's
dependency array is `[userId]`, `[fetchMeta]`, `[fetchAllHealthData, tabEpoch]` or similar — `tab`
appears in none of them.

So on every mount the screen fetches:

- **12 calls inside `fetchAllHealthData`** (`health-content.tsx:329-402`) —
  `activity-types`, `health/trends`, `injuries`, `muscle-recovery`, `progress-summary`,
  `sleep-performance-correlation`, `strength-trend`, `training-load`, `user/goals`,
  `weekly-muscle-sets`, `weekly-stats`, `workout-data`
- **4 more** alongside it — `body-metadata`, `readiness-score`, `sleep-sessions`,
  `workout-data?tab=meta`, `day-log`
- **plus 15 self-fetching child components** under `components/health/`, each with its own
  `cachedFetch` calls

…and then renders **one** of three tabs. `progress-summary` and `strength-trend` are Progress-tab
data; `weekly-muscle-sets` and `muscle-recovery` are Training-tab data; `body-metadata` is Body-tab
data. Two thirds of that work is discarded on every visit.

---

## Task 1: Confirm the shape before changing anything

- [ ] **Step 1: Verify no fetch gates on `tab` today**

Run: `grep -nE "^\s*\}, \[.*\]\);?$" app/health/health-content.tsx`
Expected: no dependency array contains `tab`. If one does, this plan's premise has changed — re-read
the file before continuing.

- [ ] **Step 2: Record the baseline request count**

With `pnpm dev` running, open the Health screen with DevTools' Network panel filtered to `/api/`, and
note the count. Write the number into this file under "Baseline". You need it to prove the change
worked; a count that does not drop means the gating is not taking effect.

- [ ] **Step 3: Map each fetch to the tab that consumes it**

For each of the 16 fetches, find which of `renderBodySection` / `renderTrainingSection` /
`renderProgressSection` (`health-content.tsx:742`) uses its state. Write the mapping into this file
before writing code — a fetch assigned to the wrong tab produces an empty card, which is worse than a
slow one.

**A fetch whose data is used by more than one tab stays ungated.** Do not force a shared fetch into
one tab.

---

## Task 2: Gate `fetchAllHealthData` on the active tab

**Files:**
- Modify: `app/health/health-content.tsx:329-406`

- [ ] **Step 1: Split the callback by tab**

Replace the single `fetchAllHealthData` with three callbacks — `fetchBodyData`, `fetchTrainingData`,
`fetchProgressData` — plus a `fetchSharedData` for anything Task 1 Step 3 found to be cross-tab.
Each contains only the `cachedFetch` calls for its own tab.

- [ ] **Step 2: Fire shared data on mount, tab data on activation**

Keep `fetchSharedData()` in the existing mount effect. Add an effect keyed on the active tab that
calls the matching tab fetcher.

Two constraints, both load-bearing:
- **Track which tabs have already loaded** and don't re-fire on every switch back — mirror
  `TabShell`'s `mounted` array (`components/shell/tab-shell.tsx`), which is the established pattern.
- **Keep `tabEpoch` working.** The existing `[fetchAllHealthData, tabEpoch]` effect re-runs on tab
  re-activation to refresh data. That behaviour must survive: a returning user still gets fresh data,
  they just don't get the other two tabs' data.

- [ ] **Step 3: Verify the count dropped and nothing is empty**

Run `pnpm dev`, open Health on the default (`training`) tab, count `/api/` requests.
Expected: materially fewer than the Task 1 baseline, and the Training tab fully populated.
Then switch to Body and to Progress. Expected: each populates on first activation, and switching back
does not refetch.
Broken outcome: an empty card on any tab — that fetch was mapped to the wrong tab in Task 1.

- [ ] **Step 4: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "Fetch only the Health tab being shown

The screen fetched all three tabs' data on every mount and rendered one, so two
thirds of the requests were discarded before anything used them."
```

---

## Task 3: Gate the self-fetching child components

The 15 children under `components/health/` fetch independently of the parent, so Task 2 does not
touch them. A child that is not rendered does not fetch — **so this task is only needed for children
rendered on a tab other than the active one.**

**Files:**
- Modify: whichever of the 15 are mounted regardless of tab

- [ ] **Step 1: Determine which children actually mount on a non-active tab**

Read `getHealthSections` (`health-content.tsx:742`) and check whether the inactive tabs' sections are
rendered-but-hidden or genuinely not rendered.

**If they are not rendered, this task is unnecessary — stop and delete it.** React does not run a
child's effects if the child is not mounted, so the fetches never fire and there is nothing to fix.
Confirm before writing any code.

- [ ] **Step 2: If any are rendered-but-hidden, unmount them instead**

Hiding with CSS still mounts the component and still runs its fetch. Gate on the tab so the component
is not rendered at all.

- [ ] **Step 3: Re-count**

Same measurement as Task 2 Step 3. Record the new number.

---

## Task 4: Verify on device

- [ ] **Step 1: Deploy and open Health on the S25**

With DevTools attached over USB, filter Network to `/api/` and note the request count on the default
tab.
Expected: well below the 53–85 the owner measured on 2026-07-29.

- [ ] **Step 2: Check each tab populates**

Body, Training, Progress. Every card must have data. An empty card means a mis-mapped fetch.

- [ ] **Step 3: Check a returning visit still refreshes**

Leave Health, come back. Expected: data refreshes (the `tabEpoch` path), and it does not re-fetch the
tabs you never opened.

---

## What this plan does NOT do

- **No aggregate endpoint.** The withdrawn version proposed `/api/home-bootstrap`. Not fetching data
  is strictly better than fetching it in one round trip, and it is a far smaller change.
- **No pool tuning.** `max: 10` stays. See the withdrawn-framing note above.
- **No touching the server-only aggregates** (`weekly-stats`, `weekly-muscle-sets`,
  `weights-summary`, `muscle-recovery`, `home-day-timeline`) — `CLAUDE.md` sanctions those as
  server-computed by design. This plan changes *when* they are fetched, never *where from*.
- **No component-splitting.** `health-content.tsx` is 915 lines and over the ~800-line guidance in
  `CLAUDE.md`, but mixing a split into a behavioural change makes both harder to review. If it grows
  during this work, split it in a follow-up.

## Baseline

*(Fill in from Task 1 Step 2 before implementing, and from Task 3 Step 3 after.)*

| | `/api/` requests on Health |
|---|---|
| Device, 2026-07-29, before | 53–85 (total requests; roughly half are the SW's paired re-fetch) |
| Local, before | *to fill* |
| Local, after | *to fill* |
| Device, after | *to fill* |
