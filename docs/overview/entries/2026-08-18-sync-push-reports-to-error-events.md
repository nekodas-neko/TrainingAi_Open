# 2026-08-18 — sync/push can finally report a fault (Q-487)

**Lane A** · branch `fix/sync-push-reports-to-error-events` · one call and its tests · no migration,
no Kotlin, no APK.

This is the half of Q-475 that its fix did not cover. #115 landed the classification correctly and
the behaviour is right — the client no longer dead-letters a working queue during an outage. The
**reporting** was still missing.

`reportServerError` was called only in the route's **outer** catch, which `pushMutations` never
reaches, because it catches per mutation by design — that catch is what makes the poison-pill rule
work and must not be removed. So a push failure hit `console.error` and stopped there, never reaching
`error_events`: the table `CLAUDE.md` calls *"the only view of faults that never reach a human"*, and
the one the session-start ritual reads.

**The gap's shape was an absence, which is why it survived.** Re-derived against production today,
before the 30-day prune takes it:

| Route | Faults in `error_events` | Span |
|---|---:|---|
| `/api/sync/pull` | **69** | 2026-07-19 → 2026-08-13 |
| `/api/sync/push` | **0** | never appeared |

Not less traffic — `components/sync-provider.tsx` runs push *before* pull in the same cycle.

## What changed

After `pushMutations` returns, the route reports the **retryable** errors. Only those: a validation
rejection is the client sending something wrong, not a server fault, and reporting it would bury real
failures in routine noise. The classification that makes the distinction already existed as of #115,
so this is an addition on top rather than new machinery.

**One row per push, not per mutation.** A 100-mutation batch against a dead database would otherwise
write 100 near-identical rows — and `error_events` is a table this repo has already had to reclaim
49 MB from once. The message carries the count, the affected domains deduped, and the first error.

## Verified live, with a fault that is not contrived

Inducing a *real* retryable failure while the database stays up: hold `ACCESS EXCLUSIVE` on
`body_metrics` — exactly what the admin `VACUUM FULL` button does — so the push's INSERT blocks and
the pool's 15 s `statement_timeout` cancels it.

```
/api/sync/push >> sync/push: 1 of 1 mutation(s) failed with a retryable server error
                  [body_metrics] — first: Error: Failed query: insert into "body_metrics" …
```

The first `/api/sync/push` row that has ever existed. A validation rejection in the same session
produced **0** rows, so the noise suppression holds.

## The limitation, stated plainly

**A total outage still cannot be reported, and this fix does not change that.** `reportServerError`
writes to the database; if that database is unreachable, the insert fails and is swallowed
(deliberately — recording an error must never mask the original). Measured: stopping Postgres and
pushing produced the correct `retryable: true` response and **no** `error_events` row.

That limitation is inherent and applies equally to `/api/sync/pull`'s existing reporting — whose 69
rows are therefore all partial or recovering faults, one of them reading
`[cause: timeout exceeded when trying to connect]`. What this PR fixes is the *structural* gap: push
had no path to the table at all, in any circumstance. It now has the same path pull has, and catches
the same classes — disk-full, connection killed mid-flight, lock timeout, deadlock, statement timeout
— which is where the interesting faults have actually been.

## Not exercised

Production, and the APK. The route has no device-specific path.
