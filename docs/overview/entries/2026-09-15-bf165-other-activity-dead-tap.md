# 2026-09-15 — BF-165: a dead tap whose source path is entirely correct (BugFix intake)

Docs-only. Owner: *"when I try click the treadmill; or any 'Other activity' nothing actually
happens."*

## Why this one matters more than it looks

BF-160 established that a fitness test earns no calories, and **Other activity → Treadmill** is what
the owner was told yesterday to use for a steady treadmill walk, because the guided walk is
interval-only and cannot be flattened. That recommendation currently ends at a dead button.

## The entry is mostly an elimination list, deliberately

Every file on the path was traced and is correct, and `git log --since=2026-09-10` shows **none of
them changed**:

| checked | verdict |
|---|---|
| `selectType` | `startActivity(...)` → close sheet → `router.push('/activity')`, prefetched on open |
| `activity-type-grid` | real `<button>`, `onClick={() => onSelect(type)}` |
| `startActivity` | sets `mode: 'pre'` + type; the rehydrate reconciler only demotes `done`/stale `active`, so it cannot wipe a fresh selection |
| `activity-screen` | `pre` + type → `PreActivityScreen` |
| `page.tsx` / `pre-activity-screen` | auth guard; no mount-time fetch, no throw candidate |
| `getActivityIcon` | `?? DotsThreeCircle` fallback — a bad icon cannot throw |
| `tabKeyForHref('/activity')` | **null**, so it is a real navigation, not a shell flip |
| `/api/activity-types` | returns all 10 types, `treadmill` among them |

Writing that down is the point. Without it the next session repeats the same two hours and reaches
the same place.

## Where it actually points

Runtime, and the entry ranks three candidates by how cheaply they can be told apart on device. The
first is the strongest: `useTransitionRouter` freezes the outgoing screen and polls for route commit
against a **300 ms** cap, and its own comments record that path misbehaving twice before. A
navigation that never commits leaves the old screen up — which is exactly "nothing happens". The
other two are a WebView chunk-load failure and the sheet's close cancelling the push in the same
tick.

`error_events` carries nothing for `/activity` or `/cardio` over three days. That rules out a
reported exception; it does not rule out anything else, because a navigation that silently does not
happen throws nothing.

## Not exercised

Docs only, and the limitation is the finding: this needed the device console and the sandbox has
none. The entry says so rather than guessing a fix.
