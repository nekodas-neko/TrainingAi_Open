# 2026-09-08 — the Workout Review pair gets tests (PS-39)

**Branch:** `test/workout-review-session` · **Lane:** A · tests + docs only, no product code changed.

## What shipped

`lib/__tests__/workout-review-routes.test.ts` — 30 cases across
`app/api/workout-review/session/[sessionId]/route.ts` and its `…/apply` sibling. **Batched
deliberately**: they are the read and write halves of one feature and verify together, and `apply`
turned out to be uncovered as well, so testing the review route alone would have left the half that
actually writes to the database untested.

They divide the way this app divides everywhere — the review route asks a model what to change, the
apply route writes it — so the model is load-bearing in neither, and each has its own way of not
trusting it:

- **Review** discards any `session_exercise_id` the model invented (`reconcileReview` keys off the
  session's own exercises, and the discarded ids come back as `invalidIds`), and refuses the model
  the session's last primary lift whatever it asks for.
- **Apply** validates every client-supplied id against the caller's own active program session — an
  id from anywhere else reaches no write, in `adjustments`, `dropThisCycle` or `dropPermanent`
  alike — and stamps its own `confidence: 1.0` over whatever the client sent, because an apply is a
  user-confirmed change and must never trip the card's low-confidence gate.

Both are invisible from outside: a route that stopped checking ids returns the same shape.

Also pinned: the refusal ladder on both (401, malformed uuid before any DB call, 429 at the eleventh
review in an hour, "not AI-dynamic", an unfinished baseline week, 404 for no training data or a
session that left the active program, 502 — not 500 — when the model fails); the role floor raising
a 1-set primary to 2; a permanent drop beating an adjustment and a this-cycle drop for the same
exercise, deduped, and counted only when the repository actually removed it; the prune that rewrites
an existing prescription pointing at a deleted exercise even when there is nothing to overlay;
`.strict()` rejecting an unknown body key; 413 on an oversized body; and a baseline session storing
`accumulation` rather than `baseline` as its phase.

`scripts/check-route-test-coverage.js` baseline 130 → **128**.

## Notes

- **One case asserted behaviour that does not exist, and the code was right.** The first version
  claimed a *pending* prescription never supplies the review's "before" numbers. It does when its
  `phaseAction` is `stay` — those numbers are already today's load and only the phase decision is
  open; `PENDING_ACTIONS_THAT_DRIVE_LOAD` says so, with the reasoning above it. The real opt-in case
  is a pending `deload`, which changes whether you train hard at all. Both are now pinned, which is
  a better outcome than the assertion I set out to write.
- Thirteen mutations were run across the two routes — the prescription-status check, the uuid guard,
  502→500, a 1000/hour limit, the baseline gate, the id validation, the client's confidence, the
  role floor, the accept-after-store, counting a refused removal, the prune branch, `.strict()`, and
  the baseline phase fallback. All thirteen were caught, each by one case.
- `reconcileReview` is **not** mocked — it is the thing worth holding. `aggregateSignals` and the
  two prompt builders are, being a wide read and a string formatter; the prompt stub keeps the
  "before" numbers legible, which is what the prescription cases assert on.
- Two of the twelve believed-tested-and-not routes remain: `workout-data` (600 lines, the biggest)
  and `ai-periodization/session/[sessionId]/prescribe`.
