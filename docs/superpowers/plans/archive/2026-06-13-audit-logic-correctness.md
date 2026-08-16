# Logic & Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the data-integrity and edge-case correctness issues found in the 2026-06-13 audit, and clean up two stale doc/rule notes.

**Architecture:** The two strict project rules (timezone, no-hardcoded-session-names) are in good shape — the previously-flagged violations are already fixed/removed. Remaining items are localized correctness bugs, the largest being a personal-record write that commits before its backing set-log transaction.

**Tech Stack:** Next.js route handlers, Drizzle transactions, `vitest` for the pure-logic tests.

---

## Findings addressed

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| L1 | **Medium** | `app/api/log-exercise/route.ts:182-185` vs `:214` | `upsertPersonalRecordIfBetter` commits a new PR BEFORE the `logExerciseAndSets` transaction. If the log fails, the PR is permanently inflated with no backing log. |
| L2 | **Low** | `app/api/log-exercise/route.ts:143` | Bodyweight load uses `bodyMetrics.find(m => m.weightKg != null)` — not guaranteed most-recent; falls back to `0` (pull-up 1RM = added load only). |
| L3 | **Low** | `lib/achievements.ts:204` | Calorie-goal streak counts a day as "hit" when `total_cals >= target` — wrong for a user in a deficit/cut. |
| L4 | **Low** | `components/workout-screen.tsx:418` | Offline `useFor1rm` defaults to `true`; server uses the smarter `allRepsEqual ? true : r === minReps`. Offline 1RM diverges until server replaces the row. |
| L5 | **Low (doc)** | `CLAUDE.md`, `projectOverview.md:~2358` | `SESSION_TO_TAB` "known violation" note is stale — the symbol no longer exists. |
| L6 | **Low (doc)** | `projectOverview.md` Known Issues | "Workout state lost on page refresh" appears already mitigated by the Zustand `persist` store — re-verify and strike through. |

---

## Task 1: Move the PR write inside/after the log transaction (L1)

**Files:**
- Modify: `app/api/log-exercise/route.ts:181-185` and `:212-224`

Currently the PR is upserted at line 184, then the log transaction runs at line 214. Reorder so the PR is only written AFTER the set-log transaction succeeds, so a failed log can never inflate `personal_records`.

- [ ] **Step 1: Read the full span to confirm `isPR`/`estimated1rm` usage downstream**

Run: `grep -n "isPR\|estimated1rm\|logExerciseAndSets\|upsertPersonalRecordIfBetter" app/api/log-exercise/route.ts`
Confirm `isPR` is only used in the JSON response (not needed before the transaction).

- [ ] **Step 2: Remove the early PR upsert**

Delete lines 181-185 (the `let isPR = false; if (...) { isPR = await repo.upsertPersonalRecordIfBetter(...) }` block). Keep the `estimated1rm`/`target80` computation above it.

- [ ] **Step 3: Re-add the PR upsert after the transaction**

Immediately AFTER the `await pgRepo.logExerciseAndSets({...})` call (after line 224's closing, where `exerciseLog` is now in scope), insert:

```ts
  // Record the PR only after the set-log transaction has committed, so a failed
  // log can never leave an inflated personal record with no backing data.
  let isPR = false
  if (estimated1rm > 0 && (!isAnyDeload || isBaseline)) {
    isPR = await repo.upsertPersonalRecordIfBetter(userId, exercise, estimated1rm)
  }
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (`isPR` still defined before the response that returns it).

- [ ] **Step 5: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "Record personal records only after the set-log transaction commits"
```

---

## Task 2: Use the most-recent bodyweight for bodyweight-exercise load (L2)

**Files:**
- Modify: `app/api/log-exercise/route.ts:142-144`

- [ ] **Step 1: Confirm `listBodyMetrics` ordering**

Run: `grep -n "async listBodyMetrics" lib/data/postgres/adapter.ts` then read it. Note whether rows come back ascending or descending by `date`.

- [ ] **Step 2: Pick the latest weigh-in explicitly**

Replace line 143:

```ts
    const bodyweightKg = bodyMetrics.find(m => m.weightKg != null)?.weightKg ?? 0
```

with an explicit "latest non-null" selection independent of list order:

```ts
    const withWeight = bodyMetrics.filter(m => m.weightKg != null)
    const latest = withWeight.sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    const bodyweightKg = latest?.weightKg ?? 0
```

> Leaving the `?? 0` fallback as-is is acceptable for this fix (a separate UX improvement could surface "log a bodyweight first"). The bug being fixed is picking an arbitrary rather than the most-recent weigh-in.

- [ ] **Step 3: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add app/api/log-exercise/route.ts
git commit -m "Use the most-recent bodyweight when computing bodyweight-exercise load"
```

---

## Task 3: Align offline useFor1rm default with the server (L4)

**Files:**
- Modify: `components/workout-screen.tsx:~418` (the offline set-log payload construction)

- [ ] **Step 1: Locate the offline payload build**

Run: `grep -n "useFor1rm" components/workout-screen.tsx`
Find where the offline `setLogs[i].useFor1rm` defaults to `true`.

- [ ] **Step 2: Mirror the server default**

Replace the `useFor1rm: true` default with the server's logic so offline-computed 1RM/intensity matches until the server response replaces the row:

```ts
  const repsArr = /* the reps array for this exercise */;
  const allRepsEqual = repsArr.every(r => r === repsArr[0]);
  const minReps = Math.min(...repsArr);
  // per set i:
  useFor1rm: progressionStyle?.[i]?.useFor1rm ?? (allRepsEqual ? true : repsArr[i] === minReps),
```

> Match the variable names already in scope at that call site; the key change is `(allRepsEqual ? true : reps === minReps)` replacing the unconditional `true`.

- [ ] **Step 3: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add components/workout-screen.tsx
git commit -m "Match offline useFor1rm default to the server's lowest-rep rule"
```

---

## Task 4: Confirm calorie-streak semantics (L3)

**Files:**
- Possibly modify: `lib/achievements.ts:204`
- Test: `lib/__tests__/calorie-streak.test.ts` (new, if logic changes)

This is a semantics question, not a clear bug — `>= target` is correct for "eat at least X" (bulking) but wrong for a cut.

- [ ] **Step 1: Ask the user the intended semantics**

Use `AskUserQuestion`: "The calorie-goal streak counts a day as a hit when calories ≥ target. For a user cutting (deficit), exceeding the target should be a miss. Should the streak be: (a) keep ≥ target [bulk], (b) within ±10% band, or (c) respect the user's goal direction (≤ for cut, ≥ for bulk)?"

- [ ] **Step 2 (only if a change is chosen): Write the failing test**

Create `lib/__tests__/calorie-streak.test.ts` asserting the chosen rule (e.g. for a band: 2050 cals against a 2000 target with ±10% counts as a hit; 2300 does not). Use the existing pure-function test style in `lib/__tests__/`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test calorie-streak`
Expected: FAIL.

- [ ] **Step 4: Implement the chosen rule** in `lib/achievements.ts` near line 204.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test calorie-streak`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/achievements.ts lib/__tests__/calorie-streak.test.ts
git commit -m "Adjust calorie-goal streak to respect the user's goal direction"
```

---

## Task 5: Clean up the stale SESSION_TO_TAB rule note (L5)

**Files:**
- Modify: `CLAUDE.md` (the "Known hardcoded violations" + `SESSION_TO_TAB` lines)
- Modify: `projectOverview.md` (the stale `SESSION_TO_TAB` reference)

> Per CLAUDE.md, documentation-only `.md` changes commit directly to `main` without a feature branch. If running this task standalone, do that; if batching with the other audit tasks on the feature branch, keep it together and note it in the PR.

- [ ] **Step 1: Verify the symbol is gone**

Run: `grep -rn "SESSION_TO_TAB" --include=*.ts --include=*.tsx .`
Expected: no matches in source (only docs).

- [ ] **Step 2: Update CLAUDE.md**

Remove the `SESSION_TO_TAB` bullet from the "Known hardcoded violations to fix" list and the line `**\`SESSION_TO_TAB\` in \`utils.ts\` is a known violation**`, since the symbol no longer exists. Keep the general "No Hardcoded Session Names" rule.

- [ ] **Step 3: Update projectOverview.md**

Remove/strike the stale `SESSION_TO_TAB` reference.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md projectOverview.md
git commit -m "Remove stale SESSION_TO_TAB violation note (symbol no longer exists)"
```

---

## Task 6: Re-verify and update the "workout state lost on refresh" issue (L6)

**Files:**
- Modify: `projectOverview.md` (Known Issues H/B table)

- [ ] **Step 1: Confirm the persist config**

Run: `grep -n "persist\|partialize\|onRehydrateStorage\|createJSONStorage" lib/stores/workout-store.ts`
Confirm `persist` wraps the store with no `partialize` (so `mode`, `workoutStartMs`, `setWeights`, timer timestamps all persist) and `onRehydrateStorage` clears stale `todayLogged` on date rollover.

- [ ] **Step 2: Manual refresh test**

Run: `pnpm dev`, start a workout, log a set, refresh the page. Confirm the workout resumes in the same mode with set data intact.

- [ ] **Step 3: Update the issue status**

If verified fixed, strike through the "Workout state lost on page refresh" Known Issue in `projectOverview.md` with a note: "Mitigated by Zustand `persist` to localStorage (no `partialize`); verified resuming after refresh — session N." If a real gap remains (e.g. an in-flight timer drifts), document the precise residual instead.

- [ ] **Step 4: Commit**

```bash
git add projectOverview.md
git commit -m "Mark workout-state-on-refresh as mitigated by the persisted store"
```

---

## Verification before completion (whole plan)

- [ ] Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint` — all PASS.
- [ ] Manual (local DB): log a normal set → PR still records correctly and the response `isPR` flag is right; simulate a log failure (e.g. temporarily throw in `logExerciseAndSets`) → no new `personal_records` row is created.
- [ ] Manual: log a bodyweight exercise (pull-up) with multiple weigh-ins on record → 1RM uses the latest bodyweight.
- [ ] Push: `git push -u origin claude/app-comprehensive-audit-goew61`.

## Local testing notes (per CLAUDE.md)
- **Pull:** `git pull origin claude/app-comprehensive-audit-goew61`
- **What to look for:** PRs only persist when the set actually logged; bodyweight 1RM uses the right weight; (if changed) calorie streak respects goal direction.
- **Regression to check:** the log-exercise response shape (`isPR`, `estimated1rm`, `target80`) is unchanged for the client.
