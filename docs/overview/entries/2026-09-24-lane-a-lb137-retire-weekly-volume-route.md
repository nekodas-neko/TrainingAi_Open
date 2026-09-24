# 2026-09-24 — LB-137: retire the route, keep the computation

**Branch:** `lane-a/lb137-weekly-volume-target` · **Lane A** · one route deleted, two invalidations
dropped, two test files updated. No migration, no client change.

## Every claim held

| claim | checked |
|---|---|
| `AiWeeklyVolumeCard` deleted by RV-120 | **0** references anywhere |
| `weekly-volume-target` has no reader | referenced only by the two `invalidateCache` calls and their tests |
| `/api/ai-periodization/weekly-volume` has no caller | referenced only by its own test file |
| `getWeeklySetsByMuscleGroup` is still live | yes, via `signals.ts` |

## The decision the entry left open

It offered two endings — *"keep the route as a debug surface and drop just the two invalidations, or
retire route + key + tests together"* — and left the choice to whoever took it.

**Retired.** The deciding detail is that this is **not a debug surface**: the route is
`auth()`-gated for any signed-in user, not admin-gated, so it is an ordinary product endpoint that
nothing calls. "Keep it for debugging" is the reasoning that accumulates dead routes, and it is
weakest where the thing kept is reachable by users rather than by an operator.

Nothing analytic is lost — `getWeeklySetsByMuscleGroup` still grades a week for the AI engine
through `signals.ts`. What went is 46 lines of HTTP in front of it. Reversal is `git revert`, and
the repository method it called is untouched.

## The absence is asserted, not just deleted

Removing a key from three expectation lists leaves nothing saying it must stay gone, and the cheap
way for it to come back is someone re-adding it beside its neighbours. So the test walks **every**
group that could plausibly clear it and asserts none does:

```ts
for (const run of [invalidateProgramStructure, invalidateAiPeriodization,
                   () => invalidatePrescriptionChanged('sess-1'), invalidateWorkoutSummaries]) { … }
```

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | the key returns to `invalidateAiPeriodization` | killed |
| 2 | the key returns to the workout-summaries list | killed |
| C | the single call rewritten as a one-element `Promise.all` | **survived** (correct) |

## Also corrected

`getWeeklySetsByMuscleGroup`'s doc comment named *"its two callers"* and listed the route. Left
alone it would have been a pointer to a file that no longer exists — the kind of stale comment that
sends the next reader looking for a caller that was deleted a month earlier.

## Failure surfaces not exercised

No device, no production. The route was deleted rather than exercised; what is verified is that
nothing referenced it, which is the claim that matters for a deletion.
