/**
 * The request init for the post-completion `POST /api/ai-periodization/session/<id>/prescribe` call.
 *
 * **LA-177 — why a body is sent at all.** Without `excludeSessionId`, `signals.ts` measures
 * `hoursSinceLastSession` from the newest completed session, which after a completion is the one that
 * finished seconds ago, so it reads about 0. `shouldTriggerEmergencyDeload` fires on
 * `hoursSinceLastSession < 36 && soreMusclesInSession.length >= 3`, so a lifter who logged three sore
 * muscles is offered an emergency deload for their NEXT session. It is built without the model, so no
 * `ai_call_log` row records that it happened. The route has always accepted the parameter and its own
 * comment states the contract (W5 §4.2); the client stopped sending it when the trigger moved
 * client-side.
 *
 * **Why an empty id omits the field instead of sending `''`.** `workoutSessionId` is a `string`
 * initialised to `''`, never null, so the obvious flat `JSON.stringify({ excludeSessionId: wsId })`
 * sends an empty string rather than failing. That is worse than it looks: `signals.ts` compares
 * `s.id !== ''`, which matches every real session, so the exclusion does nothing — and
 * `generate-prescription.ts` keys its dedup cache on `${excludeSessionId ?? ''}`, so `''` collapses the
 * completion-path key onto the open-path one. Omitting keeps the two plans distinct, which is the other
 * half of what sending the field buys.
 *
 * Extracted from `workout-screen.tsx` rather than appended to it: that file is a `check-component-size`
 * hotspot, and a pure function can be tested by calling it instead of by matching its source text.
 */
export function prescribeRequestInit(excludeSessionId: string): RequestInit {
  if (!excludeSessionId) return { method: 'POST' }
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ excludeSessionId }),
  }
}
