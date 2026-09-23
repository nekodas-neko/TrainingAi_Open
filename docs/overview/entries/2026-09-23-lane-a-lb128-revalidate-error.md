# 2026-09-23 — LB-128: the failure a caller could not be told about

**Branch:** `lane-a/lb128-revalidation-error` · **Lane A** · `lib/sqlite/cache.ts`,
`packages/shared/src/fetch-with-retry.ts`, plus the one caller the entry was written for. No
migration, no schema change.

## The entry held up at source, both halves

`cachedFetchCore` gates `onError` on `cached === null` in **both** failure branches — the `!res.ok`
one and the network-throw one — and joined waiters skip on `hadCached`. So a failed revalidation of
a key that painted from cache reached nobody.

`fetchWithRetry` has the mirror-image blind spot, and it is the one that makes the first
unavoidable: `responded` is set by **any** `onData`, and a cached paint is an `onData`. The ladder
stops on attempt 0 and `onExhausted` never fires. From inside the helper, a cached paint plus a
dead network is indistinguishable from success.

Together: no caller could report a failed refresh of a key holding a cached value — exactly the
post-write case RV-103 was about, whenever the write's invalidation had not yet cleared the entry.

## The fix is a complement, not a relaxation

`onRevalidateError` fires **only** when a cached value *was* painted. `onError` and it are mutually
exclusive by construction, which is what the tests pin.

The entry's warning was the design constraint and it is right: **ungating `onError` would have been
wrong.** Every existing caller reads it as *"I have nothing to show"*, and `useCachedValue` renders
an error state from it — so ungating would have replaced good cached data with error cards across
the app.

It stays gated on being **online**. Offline with saved data is the sanctioned offline-first case,
the outbox carries the write, and an error card there would be a lie about what happened.

`fetchWithRetry` forwards it, guarded on `isCancelled()` for the same reason `onExhausted` is. It
can fire on more than one attempt, so a caller rendering from it must be idempotent — which the one
caller is, because `refetch` clears the flag first.

## The caller was wired, and that was not scope creep

`app/nutrition/use-energy-balance-refetch.ts` carried a long comment ending *"needs
`lib/sqlite/cache.ts` to offer an ungated failure channel, which is Lane A's, and is filed as
LB-128"*. That sentence becomes false the moment this ships, so the file had to be touched
regardless; wiring `onRevalidateError` beside `onExhausted` is one line on top of that.

The two channels cover different halves of one failure. `onExhausted` covers the post-write norm —
the invalidation emptied the key, the retries run against nothing. `onRevalidateError` covers the
residue — a stale entry survived the invalidation and painted. RV-103 measured that residue as a
flake: the same code reported or stayed silent on consecutive runs, decided only by whether the
entry happened to be in the cache. **The flake was the finding.**

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | `!res.ok` branch never fires the new channel | killed |
| 2 | network-throw branch drops the online gate | killed |
| 3 | waiters with cached values skipped again | killed |
| 4 | `fetchWithRetry` accepts the option, never forwards it | killed |
| 5 | caller takes `onExhausted` only | killed |
| C | fire via a named local instead of inline | **survived** (correct) |

Mutant 2 is the one worth keeping: it would make the app report a failure every time the user is
simply offline, which is the opposite of what this codebase is built for, and nothing else in the
suite would have caught it.

## Not done, and one thing I am flagging rather than fixing

- **`cachedFetchCore` now takes ten positional parameters.** That is one too many to read, and the
  honest fix is an options object — deliberately not done here, because it touches every call path
  and would bury a behavioural change in a signature refactor. Worth a separate entry if anyone
  adds an eleventh.
- **RV-103's `Keep:` was updated rather than struck.** Its reporting path now has a working channel,
  but the **device check is still owed** — the failure line and its Retry at S25 width, in the card
  that carries "kcal left".
- **Failure surfaces not exercised:** the device. These are jsdom tests against localStorage,
  because `isSQLiteAvailable()` is false there; the native SQLite cache path is not run, and neither
  is the real offline transition (`navigator.onLine` is stubbed).
