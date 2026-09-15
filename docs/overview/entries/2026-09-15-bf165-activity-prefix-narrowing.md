# 2026-09-15 — BF-165: it is the `/activity` prefix, and there is a second dead button

**Branch:** `docs/bf165-activity-prefix-narrowing` · **Lane B** · docs-only

The previous entry left BF-165 with one surviving candidate — `router.push` not committing through
`animate()` — and one specified experiment: drive the same push from a control **not inside a sheet**.

`modality-picker.tsx` already provides it. Two buttons sit on `/cardio`, both using
`useTransitionRouter`, both with non-tab hrefs, **neither inside a sheet**.

| tap | destination | result |
|---|---|---|
| **Running** | `/running` | **navigates** ✓ |
| **Guided walk** | `/activity/guided-walk` | **stays on `/cardio`** ✗ |
| Other activity → Treadmill | `/activity` | stays on `/cardio` ✗ |

## What that kills

**`animate()` is not the defect.** Running commits through the identical code path — same router,
same `startViewTransition`, same 300 ms cap. The view-transition machinery works.

**The sheet is not the variable.** Guided walk fails with no sheet anywhere near it. The portal
context, the `BackDismiss` history entry, the close-in-the-same-tick — all irrelevant.

**Both failures share the `/activity` prefix and the success does not.** That is the variable.

## A second dead button, which the owner has not reported

**Guided walk on the Cardio hub does not navigate either.** The report covered only *"Other
activity"*. So BF-165's scope is wider than filed: anything reaching an `/activity*` route from a
client-side push is dead.

That matters beyond the diagnosis. BF-160 established that a fitness test earns no calories and that
*"Other activity → Treadmill"* is the recommended way to log a steady treadmill walk — and the guided
walk is the other half of that surface. Both routes into it from the hub are currently dead.

## It fails silently, which is why nothing was ever logged

During the failing tap: **no console errors, no `pageerror`, no failed requests, no response ≥ 400.**

That is consistent with `error_events` holding nothing for this across three days, and it rules out
the chunk-load failure that was candidate 2's fallback reading. Nothing throws. The navigation simply
does not happen.

## Not a routing-configuration difference

Checked rather than assumed: `app/activity/page.tsx` and `app/running/page.tsx` are both plain pages,
**neither has a `layout.tsx`**, and `middleware.ts` mentions neither. Structurally they are the same
shape.

So the difference is in what the page — or the tree it pulls in — does during a **client-side commit**.
A direct `goto('/activity')` renders fine (200, no errors), so whatever it is bites only on the push
path.

## The next experiment

Bisect what `app/activity/page.tsx` and its tree (`activity-screen.tsx`, `activity-store`,
`reconcileRehydratedActivity`) do on a client commit that `app/running/page.tsx` does not.

The comparison is unusually clean: two structurally identical routes, one working and one not,
reachable from adjacent buttons on the same screen.

## Nothing shipped in code

Same reasoning as before: the probe asserts a navigation that does not happen, so it is red by
construction. The cause is not yet identified, and the surviving suspect has moved from app-wide
navigation to something specific to one route tree — which is a much better place to be, and still
not a place to change code from.
