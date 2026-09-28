# 2026-09-28 — LA-177: the completion-time prescribe call excludes the session that just finished

**Lane B.** Branch `fix/prescribe-excludes-completed-session`. v1.478.3.

## What shipped

`components/workout-screen.tsx` — the post-completion `POST /api/ai-periodization/session/<id>/prescribe`
now sends `{ excludeSessionId: wsId }` with a JSON content type, via a new pure helper
`components/workout/prescribe-request.ts`. Tests: `components/workout/__tests__/prescribe-request.test.ts`
(4 behavioural cases) plus 2 wiring cases in `components/__tests__/workout-completion-surface.test.ts`.

**`workout-screen.tsx` ends 9 lines SHORTER than it started**, which is how this landed at all — see
*The size check refused the append* below.

## The defect, verified rather than taken on trust

Every claim in the entry checked out against `main`:

- The completion call sent `{ method: "POST" }` and no body (`workout-screen.tsx`, in `completeWorkout`).
- `signals.ts:335` — `last5.find(s => s.completedAt != null && s.id !== excludeSessionId)`. With no
  exclusion the newest completed session *is* the one that just finished, so `hoursSinceLastSession`
  reads about 0.
- `emergency-deload.ts:34` — `hoursSinceLastSession !== null && hoursSinceLastSession < 36 && soreMusclesInSession.length >= 3`.
  So a lifter who logged three sore muscles is offered an emergency deload for their **next** session.
- The route has always accepted it (`prescribe/route.ts:43`, `excludeSessionId: z.string().optional()`)
  and its own comment states the contract: *"excluded from the hoursSinceLastSession gap so a fresh
  completion can't self-trigger the emergency deload (W5 §4.2)"*. The client stopped honouring it when
  the trigger moved off the server.
- The deload is built without the model, so no `ai_call_log` row records that it happened.

## One correction to the entry's fix

It prescribed `body: JSON.stringify({ excludeSessionId: wsId })` flat. **`workoutSessionId` is `string`,
initialised to `''`** (`lib/stores/workout-store.ts:149`, reset at `:240`) — not `null`. So the literal
form would not 400; it would send `""`, and that is worse than it looks:

- `signals.ts` compares `s.id !== ''`, which matches every real session, so the exclusion does nothing.
- `generate-prescription.ts:286` keys its dedup cache on `${excludeSessionId ?? ''}`, so `""` produces
  **the same key as the no-body open path** — losing the separation the entry itself calls correct
  (*"a completion-path plan is not interchangeable with an open-path one"*).

So the field is **omitted** when there is no id, not sent empty. That is also the repo's standing rule
for a different reason (`.optional()` rejects `null`; clients omit rather than send empty), and here it
is load-bearing for the dedup key rather than merely tidy.

## What was deliberately not touched

The **open-time** prescribe call (the `aiPrescriptionPending` effect) stays bodyless. At open time the
newest completed session genuinely is in the past, so the gap it measures is the real one and excluding
it would discard the signal. Only the completion path needs the exclusion. The guard asserts both, so a
future change that "consistently" adds the body to the open path fails.

## The size check refused the append, and the extraction was the right answer

`check-component-size` failed: `workout-screen.tsx` went to 1854 against an 1833-line baseline. Its
message is *"this file is a known hotspot; extract, do not append"*, and the baton already carried the
lesson that trimming comments to squeeze under is the wrong response.

Two extractions, both owed independently of this fix:

- **`prescribe-request.ts`** — the request-init logic and the reasoning behind it. This also made the
  test better: the shape is now checked by *calling* the helper rather than by matching source text.
- **`beep.ts`** — `playBeep`, 17 lines of `AudioContext` with no component state, called from one
  timer. It had no business in the orchestrator.

Final: **1824 lines**, under the baseline, a net reduction of 9. The file got smaller while gaining a
fix, which is what that check exists to produce.

## Verified

- **16/16 across the two files, control-run four ways with each mutation asserted as applied**: making
  the helper send `''` instead of omitting fails 2; dropping its content type fails 1; reverting the
  completion call to the bodyless literal fails 1; giving the OPEN-time call the exclusion too fails 1.
  Restored, 16/16.
- **⚠ Two earlier controls passed, and both times the control was at fault rather than the guard** —
  recorded because it is invisible from the result. One mutation removed the *first* `Content-Type`
  header in `workout-screen.tsx` rather than the one under test; there are **four**. Correcting it
  exposed a real weakness it had been masking: asserting that header as a bare substring was satisfied
  by one of the other three fetches, so the guard was checking less than it claimed. That is what
  pushed the shape assertions out of source-matching and into the helper's own unit test. **A control
  that does not change the file proves nothing, so the mutation is now asserted (`assert new != s`)
  before the run.**
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

**Not exercised:** not run on the device, and **no spurious deload was observed** — the entry says so
too, and it cannot be reconstructed because `session_periodization` is overwritten in place rather than
kept as history. What is established is the code path, not a count of times it fired. The fix is a
request-body change on a client fetch, so no offline-first, native, safe-area, gesture or notification
surface is touched; the deload UI itself is unchanged.
