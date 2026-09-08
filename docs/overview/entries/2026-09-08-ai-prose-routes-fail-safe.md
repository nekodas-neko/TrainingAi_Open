## 2026-09-08 — Two AI routes whose failure path was the untested part (PS-39)

**Branch:** `test/believed-tested-routes-2` · **Lane A**

### What shipped

9 tests across `session-explain/insight` and `running-plan/explain`; `BASELINE` **136 → 134**. Both
are from the twelve #956 exposed as believed-tested-and-not, and they pair because they share the
property worth pinning: **the model is never load-bearing, and its failure must not leak.**

### Q-483 — the catch that published the database schema

`session-explain/insight` once returned `errorLog`'s output as the response body. `errorLog` returns
`` `[ERROR]: ${error}` ``, so a driver error published **the whole failing statement — every column
of `workout_sessions` — to the client**. Reached by a malformed id, which arrives as 22P02.

Pinned by rejecting `getNextSession` with an error whose message *is* a SQL statement and asserting
the body contains neither the statement nor the table name, is exactly `{ error: 'Internal error' }`,
and that `reportServerError` was still called — the detail is banked, not discarded. Mutation-checked
by putting `errorLog` back in the body.

### The AI is never load-bearing

`running-plan/explain` only rephrases a rationale the app already computed deterministically, so when
the model throws it must answer **200 with that rationale and `degraded: true`**. A 500 there blanks
a card that has the answer in hand. Mutation-checked by making it 500.

Also pinned: F6's input caps (`rationale` ≤ 500, `gateReasons` ≤ 12 × 500) — these strings are joined
straight into the prompt, so without caps a replayed client ships a megabyte of tokens — and the
schema's `.strict()`.

For `session-explain`, also: a fresh cached narrative is served **without calling the model**, and
Q-293's rule that the recommendation is recomputed rather than trusted from a `sessionId` param —
because signals moving during the day is the route's whole subject, so the cache key has to depend on
them. That last one is asserted by moving a signal and requiring the hash to change.

### A stub that could not fail, caught before it shipped

The first version of that hash assertion passed a stub returning `` `h:${prompt.length}` ``. Changing
Oura readiness from **80** to **42** leaves the prompt the same length, so the stub could not tell the
two apart and the case could never fail. The stub is now content-derived. **A test whose stub cannot
distinguish the inputs is not a weaker test, it is not a test** — and the only reason it surfaced is
that the case was written to fail first.

### Verification

- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean, `check-test-typecheck` at baseline,
  `pnpm build` exit 0, full suite green.
- **Mutation-checked three ways**, each failing exactly its own case: `errorLog` in the response body
  (Q-483), a 500 instead of the deterministic fallback, and dropping the F6 caps.

**Not exercised:** the model is stubbed throughout — `loggedStreamText` and `generateText` never run,
so nothing here checks prompt quality or that `PROSE_GUARDS` changes what the model writes. What is
pinned is the routes' own behaviour around the model: what they send it, what they do when it fails,
and what they refuse to put in a response.

**Seven of the twelve remain**, named in the PS-39 entry, `workout-data` (600 lines) the largest.

No version bump: tests only.
