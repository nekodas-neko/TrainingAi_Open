# 2026-09-22 — Lane A · RV-69 + RV-70: AI calls are bounded, and prose routes degrade to their own facts

Batch `ai-degrade-and-bound`, one PR, both `platform`.

## What shipped

**RV-69 — four prose routes answered an error while holding the answer.** `daily-digest`,
`weekly-digest`, `ai/health-insight` and the workout recap each assemble a complete fact block from
the user's own logs *before* calling the model; the model only writes the sentences about it. On the
catch path all four discarded it — 502 for the three digests, 500 for the recap. They now return the
facts with `degraded: true` and status 200, which is what `running-plan/explain` has always done.
`lib/ai/degrade.ts` holds the one helper.

**RV-70 — no AI call carried a wall-clock ceiling.** Every route passes `maxRetries: 0`, which takes
the SDK's own timeout handling out of the picture, and nothing replaced it. `lib/ai/deadline.ts`
applies one at the chokepoint, so every call site is bounded without opting in.

## Four things the entries got wrong, found by re-verifying before writing code

1. **"The fix is one place, since every call routes through `lib/ai/instrument.ts`" (RV-70).** The
   chokepoint wraps a *thunk*, not the SDK's params — it could not inject `abortSignal` into
   anything. The thunk now takes the signal (`AiCall<T> = (signal) => Promise<T>`) and all 17 call
   sites pass it through. A zero-argument thunk still satisfies that type, so wiring alone would be
   a silent guarantee; `runWithDeadline` also **races** the attempt, which is what makes the bound
   hold for a call site that ignores the signal — including one added later.
2. **"Sized per section" (RV-70).** Not supported by the data. Measured over the owner's
   `ai_call_log`, the slowest call of *any* section ever recorded is **4,786 ms** and every section's
   p95 is under 4 s; the spread between the fastest and slowest section is an order of magnitude
   under any ceiling worth setting. One budget, **30 s**, ~6× the worst on record.
3. **"`recap/route.ts:236` answers 502" (RV-69).** It answers **500**, from a catch covering the
   whole handler — the session lookup, three repo reads and `buildRecapFacts` as well. Degrading
   there would have answered 200 with a recap for a request that never built one, including the
   malformed-id case (22P02) behind Q-483. That route got its own catch, scoped to the model call,
   and the outer one still answers 500. `lib/__tests__/recap-route-degrade.test.ts` pins both halves.
4. **"Every route passes `maxRetries: 0`" (RV-70).** All but one: `running-plan/explain` did not, so
   the SDK's own default retries were multiplying with the shared one-retry policy rather than
   deferring to it — the exact doubling the entry was written about, in the route it held up as the
   reference. Fixed in the same change.

## The entry's own open question, answered

RV-69 flagged *"not established: how each client renders a 502 — it may already show a tolerable
empty state"*. Checked: all four do. So this was never a broken-looking UI; it was a card saying
nothing where it could have said the user's figures. **The answer changed the shape of the fix** —
the clients cache, which the entry did not account for:

- `done-screen.tsx` reads the recap through `cachedFetch` at `WORKOUT_RECAP_TTL` (24h) and the only
  retry the card offers is a refetch;
- `ai-insight-card.tsx` `setCached`s the insight for 6h;
- `weekly-recap-banner.tsx` writes the digest to `localStorage` keyed on the week and returns early
  on a hit.

A degraded 200 into any of those is **stickier than the failure it replaces**. So nothing degraded is
stored: the routes skip `upsertAiHealthInsight`, and each client is guarded on `degraded`.
`cachedFetch` gained a `shouldCache` predicate for the one that caches through it — a response can be
worth painting and not worth keeping.

## What only the dev server found

The helper's parameter was a bare noun (`'the day'`, `'the readings'`) and the lead read *"so here
is …"*. Against a running server the heart-rate section answered **"here is the readings as
recorded"** — the one subject that is plural. Every test passed, because each asserted the fact lines
and the "could not be generated" clause, and none read the joint. The parameter is the whole clause
now (`'here are the readings as recorded'`), and there is a test for it.

That is the entire argument for the pre-merge dev-server pass: it was not a logic bug, so nothing
that checks logic could see it.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**, all passed.
- Full suite — **9,304 tests, 976 files**, green. It caught what targeted runs could not:
  `lib/__tests__/weekly-digest-window.test.ts` pinned `expect(502)`. Its real property is *the error
  text must not reach the body* (the `[ERROR]: ${error}` leak); that assertion is kept and
  strengthened, since a degraded answer is a wider body than a bare error.
- `node scripts/check-test-typecheck.js` — none above baseline.
- **`pnpm dev` against the local database, both paths, all four routes.** With the real key: real
  prose from `daily-digest`, `weekly-digest`, `ai/health-insight` and the recap, no `degraded` flag,
  and a `generateObject` site (`exercises/generate`) confirming the threaded `abortSignal` does not
  disturb the SDK's object path. With a deliberately invalid key: all four answered **200 with their
  own figures and `degraded: true`** — e.g. the recap returned *"Duration: 55 min · Total volume:
  1440 kg · New personal records: 1"*. `ai_health_insights` was read afterwards and holds **only the
  real answer**; not one degraded run wrote a row. The recap's non-model failures are unchanged: 400
  on a malformed id, 404 on an unknown one, and `Cache-Control: private, no-store` on the degraded
  response.
- **Mutation pass: 11 mutations, all caught; 2 deliberately equivalent controls, both passed**
  (`>=`→`>` in the deadline comparison; budget 30s→28s). The mutations that bit include per-attempt
  instead of total budget, dropping the retry's deadline skip, dropping the race, persisting the
  degraded value at each of two routes, dropping `shouldCache`, degrading from the full prompt rather
  than the measured lines, and degrading from the context including same-day AI prose.

## Not exercised

Sandbox only. Not run on the device: nothing here is native, offline-first, safe-area or gesture
work — it is server behaviour plus three client cache guards, all reachable in the WebView through a
normal Railway deploy with no APK. **The degraded path itself has not been seen in production**,
because the model has not failed since the logging existed; it is exercised by tests at all four
routes and by the helper's own unit tests.

## Deliberately not done

`ai-periodization/session/[id]/prescribe` has the same catch-path shape and is **not** changed. It
degrades to a *prescription the user trains on*, not to text, and its backlog entry already carries
the larger question of whether the model belongs on that blocking path at all. A cross-reference was
added there.

Streaming calls (`loggedStreamText` — Coach, session-explain) are **not** bounded. Aborting a stream
mid-answer is a user-visible truncation, and a stream sends bytes as they arrive, so a stalled one is
visible in a way a stalled await is not. Worth revisiting if a stall is ever observed.
