# 2026-08-24 — four ai-periodization schemas made strict (Q-464 sweep, 79 → 75)

**Branch:** `fix/strict-schemas-batch3` · **Lane A** · four routes, no migration, no APK.

Continues the Q-464 sweep. The entry is explicit that there is no shortcut — each schema needs the
client that posts to it read, because a codemod would introduce silent 400s on rarely-exercised routes
and no test would catch them.

| route | client | keys sent |
|---|---|---|
| `ai-periodization/baseline/complete` | `health/ai-periodization-status-card.tsx` | `{sessionId}` |
| `session/[id]/prescribe` | `workout-screen.tsx` ×2, `ai-prescription-card.tsx` | **no body at all** |
| `session/[id]/prescribe` | `workout/use-duration-preset.ts` | `{durationPreset}` |
| `session/[id]/respond` | `ai-prescription-card.tsx` | `{action}` |
| `session/[id]/transition` | `ai-prescription-card.tsx` | `{newPhase}` |

## The one worth carrying forward

**`prescribe` is called with no body at all by three of its four clients.** That reads as a reason not
to tighten it, and it is not one: the route does `(read.ok ? read.body : null) ?? {}`, and `{}`
satisfies an all-optional schema whether or not it is strict.

Verified rather than argued — and the verification nearly went wrong, which is the real lesson.

## Read the message, not the status

Every probe on these routes returned **400**, including the ones that were supposed to succeed. That
looks exactly like a change that broke four routes. It was not:

| probe | body |
|---|---|
| `prescribe`, no body | `{"error":"Baseline not complete"}` |
| `respond {action}` | `{"error":"No prescription"}` |
| `transition {newPhase}` | `{"error":"Transition not recommended — pass force:true to override"}` |
| any of them + an unknown key | `{"error":"Invalid body"}` |
| `transition {newPhase, force:true}` | **200**, with real state |

Three of those 400s are the handler working correctly on a dev database with no baseline and no
prescription. Only `Invalid body` is the schema. The `force:true` case is the decisive one — a known
key reached the handler and completed a real phase transition.

Had I stopped at the status codes I would have reverted a correct change. That is now in the checker's
header for the next batch.

## Verified

Full suite **4,643 tests**; `pnpm check:rules` 55 of 55; `check-strict-request-schemas` reports
**75 non-strict across 49 files**, with all four rows removed from the baseline so they are held at
zero.

**Failure surfaces NOT exercised:** the dev database has no completed AI-periodization baseline, so
`baseline/complete`'s success path was never driven — only its schema rejection. Nothing device,
native, safe-area or offline is touched.
