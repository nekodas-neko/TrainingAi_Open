# 2026-08-23 — The worse sync failure had the softer handling (Q-476)

**Branch:** `fix/sync-push-drop-reports-error` · **Lane A**

Two ways a pushed mutation can fail, and until today they were treated in opposite proportion to
their severity:

| Failure | Caught | Outbox row | User signal | Recoverable |
|---|---|---|---|---|
| Inside `pushMutations` (bad value, FK, ownership) | adapter loop | kept, `status='failed'` | badge + toast | yes, Retry |
| The route's `MutationSchema` (unknown domain, malformed date) | route, before the adapter | **deleted** | **none** | **no** |

An empty `errors` array is how the client is told everything succeeded: `resolveFailedOutboxIds`
returns an empty map, `confirmed` takes the whole chunk, `deleteMutations` removes all of it —
including the row that was never written. The route's own comment called that *"quarantined"*.
Quarantine is what the other path does.

A `workout_log` that dead-letters gets a toast because, in the dead-letter module's own words,
*"a lost workout is the app's worst-case data loss"*. The same workout dropped one layer earlier
got nothing at all.

## The measurement, before and after

```
3 mutations, middle one domain "retired_domain"
  before  {"processed": 2, "errors": []}
  after   {"processed":1,"errors":[{"id":"m2","domain":"retired_domain","error":"Rejected by the
          sync schema at domain: Invalid input","retryable":false}, …]}

1 mutation, date "06-08-2026"
  before  {"processed": 0, "errors": []}
  after   {"processed":0,"errors":[{"id":"m9","error":"Rejected by the sync schema at date: …",
          "retryable":false}]}
```

Re-run against `pnpm dev`, signed in — the same two cases the entry measured.

## One correction to the fix shape

The entry says, quoting the adapter's unreachable `Unsupported domain` branch, *"report it as a
retryable failure"*. **Under Q-475's split that is wrong.** `retryable: true` now means *the server
could not write*: the client treats it as an outage, leaves the rows untouched, backs off the
**whole queue** and breaks the drain loop. For a rejection that can never succeed, that is the wedge
this route exists to prevent.

`retryable: false` is the per-item path — `recordMutationFailures`, attempts++, backoff,
dead-letter at `MAX_MUTATION_ATTEMPTS`, badge. That is the quarantine the entry wants, and it is
pinned by a test that goes red when the flag is flipped.

## One case that still drops

A rejection with no usable `id`. `id` is optional in the schema for pre-v13 clients, and
`resolveFailedOutboxIds` falls back to `domain:date` matching when an error record has none — which
would mark every **valid** sibling sharing that key as failed too. Dropping is all that is left, and
it is now the narrow case rather than the whole class.

## Verification

Full suite **545 files / 4,502 tests** green · `pnpm check:rules` → **51 of 51** · typecheck and
lint 0 errors. Six new route tests, and **all three design decisions are mutation-checked**:
stop merging the rejections → 4 red; flip `retryable` to `true` → 2 red; emit an entry without an id
→ 1 red.

**Not exercised:** the client half, on device. The route's contract is verified from both sides
here — the response shape, and `resolveFailedOutboxIds`/`recordMutationFailures` reading it — but no
device drained an outbox against it.

## What is left

The entry's "cheap companion": validating `domain`/`date` in `queueMutation` at write time.
Deliberately not done here — it sits on the write path of 36 call sites and is only verifiable on
device, where marking a *good* mutation failed is the app's worst-case class. The domain half is
already a compile error at the call site, so only the date half is reachable, and the entry's own
reachability note says nothing produces a rejected date today. Recorded on the entry as a `Keep:`.
