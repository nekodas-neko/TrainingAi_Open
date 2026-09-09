# 2026-09-09 — the two levers that remove data (PS-39, 36 → 34)

**Branch:** `test/oura-ble-maintenance-routes` · **No product change.**

16 cases over `oura-ble/samples/pack` and `oura-ble/samples/backfill-null-decoded` — the
destructive pair, and the ones where the app's hardest standing rule sits directly behind the
route. `oura_raw_samples.body_hex` is the archival source of truth on the server, the ring's
history buffer is finite and its sync cursor only moves forward, so a decoder fixed later can only
back-fill by re-decoding stored hex. Anything that could remove it is a one-way door.

## What the cases decide

- **`pack` is the only endpoint in the app that deletes archival frames.** It moves sealed buckets
  into one blob each and drops the hot rows only after re-reading the blob and proving the frames
  equal. The bucket bound is clamped at both ends and floored; every clamp fixture differs from the
  default 25, so a route that ignored the body could not pass by landing on the same number.
- **A failed run is a 500, never "packed 0".** *Nothing to do* and *it broke* are different answers,
  and the owner decides whether to press again from that difference — collapsing them stops a pass
  part-way through 1.1M rows while reading as complete.
- **A refused bucket is a result, not a throw.** A bucket whose re-read frames did not match is
  reported and the run continues; the verification is what makes the delete safe, so its failures
  have to be visible without abandoning the rest.
- **`backfill-null-decoded` passes `undefined` by default**, letting the repository keep its own
  500-row batching — a default invented at the route would silently override the thing that stops a
  single statement hitting the pool's `statement_timeout`. A row cap is accepted only when it is a
  finite number greater than zero.
- The stale-`isAdmin` and Q-548 503-not-403 cases are asserted here too. They are covered on the
  read routes as well, and they are worth repeating on the endpoints that **delete**: an outage must
  neither let a destructive run through nor read as a refusal.

## What the mutation pass caught in my own test

`countPackableBuckets('someone-else')` **survived**. The GET case asserted the response body and
never the user argument — and a mock returns the same rows whoever asks, so swapping the id changed
nothing observable. Every repository call in the file now asserts its user argument.

That is the fixture trap in a form specific to mocks: **a stub that ignores its arguments makes
every argument untested unless the test names them.** Checking the response proves the wiring, not
the scoping.

## Mutation pass

**16 of 17 caught** after that fix, including both clamps, the floor, the non-numeric guard, the
broken-run status, both rate limits, the 413, and each route's user scoping. The survivor is an
equivalent mutant planted as a control — a no-op TypeScript cast.

## Not exercised

The repository is mocked, so **nothing here proves the SQL leaves `body_hex` alone** — that lives in
the repository slice. What the last case does prove is that the route reaches exactly one repository
method and asks for nothing further, so an edit that added a delete beside it fails. No database, no
ring. Web/Node only: no device, no native, safe-area, gesture or notification surface.
