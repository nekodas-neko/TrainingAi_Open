# 2026-09-02 — a saved RMR test evicts the goal caches (LB-48)

**Lane A · branch `lane-a/measured-rmr-invalidation` · v1.430.1**

`POST /api/measured-rmr` invalidated nothing and `measured-rmr` was in no cache group, so after
saving an RMR test the Profile goals section painted the previous resting rate before the
revalidation corrected it. The fix is four lines: the key joins
`invalidateGoalRecommendations()`, and the RMR form calls that group on its success path — through
the named group, never a hand-rolled key list at the call site.

## The entry's severity claim was wrong, and measuring it is what kept this PR small

LB-48 said the stale value survives *"until the app is restarted"*, reasoning that
`goals-section.tsx` fetches inside a `useEffect(…, [user?.id])` in the persistent tab shell, where
`user?.id` never changes — functionally `[]`. That reasoning is sound and the conclusion is false,
because it stops one step early.

The tab shell does keep all five tabs mounted (`tab-shell.tsx` renders hidden panels with
`invisible … [content-visibility:hidden]` rather than unmounting). But the RMR form is not in the
shell: it lives at `/more/clinical`, a plain page reached with `router.push`, so navigating to it
tears the shell down. Driving `/more` → `/more/clinical` → back in Chromium logged the goals
effect **3 times, then 3 more**. It remounts. The stale value is a first-paint flash, not a
session's worth of hard staleness.

**I had already written the fix for the claimed symptom before checking it.** The first version of
this branch also converted `goals-section.tsx`'s read to `useCachedValue`, justified by "the effect
never re-runs, so the eviction lands on a component that cannot hear it". That justification is
false here, and under *do not refactor beyond what the task requires* the conversion went with it.
The eviction alone is the whole fix: it turns "stale, then correct" into "correct".

**A backlog entry (LA-54) was also written and then removed in the same session**, claiming
`check-fetch-once-effects.js` has a gap because it only flags empty dep arrays and not
session-stable ones. The general point may well be true — a `[user?.id]` dep on a component that
genuinely never unmounts is `[]` wearing a disguise — but this case does not demonstrate it, and
filing an entry on an undemonstrated premise is the failure this session has now corrected three
times. It is not in the queue.

## What is actually gained

The invalidation rule's own audit note applies: an entry is load-bearing only where a call site
passes `freshWithinTtl` or a read path is seed-only, and neither holds here — both readers
revalidate. So this is a first-paint accelerator, and clearing it replaces a briefly-wrong paint
with a correct one. That is worth doing and is what the rule asks for; it is not the hours-long
staleness the entry described.

The other reader, `more/clinical/clinical-content.tsx`, does not need the eviction at all —
`onSaved(record)` updates it locally.

## Verification

- `pnpm check:rules` — **Ran 67 of 67**, all passing. `tsc` clean; `check-test-typecheck` reports
  320 errors across 90 files, none above baseline.
- Two assertions in `lib/__tests__/measured-rmr-invalidation-reaches-goals.test.ts` (the form goes
  through the group and carries no ad-hoc `invalidateCache`; the group carries the key), plus the
  key added to the existing `cache-groups.test.ts` group assertion.
- **Against `pnpm dev`** with a real credentials session: `GET /api/measured-rmr` empty → `POST` a
  test (200) → `GET` returns it; `/more` and `/more/clinical` both render with no runtime error.
- **The remount measurement above was taken in Chromium against the dev server**, with a temporary
  `console.log` in the goals effect that is not in the diff.

**Not exercised:** the APK (this is JS only, so it reaches the device through Railway with no
rebuild), safe-area, Samsung WebView, drifted production data. The owner's production DB has no
`measured_rmr` row, so the first-paint difference is not observable there until one is saved.
