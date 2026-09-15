# 2026-09-14 — a declined weigh-in could never be claimed back, and that predates the change that exposed it (LA-108)

**Branch:** `lane-a/la108-claim-a-declined-weighin` · **Lane A** · no version bump — the list that reaches this is Lane B

## What was actually locked

I filed LA-108 earlier today as "a declined weigh-in is invisible", assuming the missing piece was a
read path. Reading the adapter before building it found something sharper.
`confirmScaleSample` matched `status = 'pending'` and nothing else:

```ts
.where(and(eq(id, id), eq(userId, userId), eq(status, 'pending')))
```

So a dismissed row could not be filed even by an id you already had. The missing list was the second
problem; **the predicate was the first**, and it is the whole reason the lockout sustains itself.

## Why that is worse than losing one reading

The band anchors on the last **confirmed** weight, and only a confirmed reading moves the anchor. A
genuine change of more than `SCALE_WEIGHT_ANOMALY_PCT` between two weigh-ins — a long gap plus an
illness or an injury — puts the owner outside his own band with nothing that can move it, so every
reading after that is outside too. No screen says so, and there was no action that could end it.

**And this predates BF-58.** An accidental *Not me* tap has always been irreversible and has always
failed to re-anchor. BF-58's outer band made the state reachable without a tap, which is what made
it worth finding — but it did not create it. My own Known-Issues row said "BF-58 introduced this"
and that was wrong; it is corrected here and in the entry.

## What shipped

- `confirmScaleSample` accepts `pending` **or** `dismissed`. Still not `confirmed` — claiming an
  already-filed reading twice would re-run `applyScaleReadingToBodyMetrics` on it.
- `listRecentDismissedScaleSamples(userId, limit)`, newest first.
- `GET /api/scale-ble/pending` returns `{ pending, dismissed }`, both arrays of the same
  `{ id, measuredAt, weightKg }` shape.

**`POST /api/scale-ble/pending/<id>/confirm` needed no change at all**, which is the pleasing part:
it was already status-agnostic beyond what the repository allowed, and it already files the weight
against the reading's own `measuredAt` rather than today (Q-25). Widening one predicate turned the
whole path on.

**What is left is a list**, and it is Lane B's: render `dismissed` under the pending section in
`scale-pairing.tsx` with a claim action pointing at the confirm route the pending rows already use.
The lane rule decides the split — reached by `app/api/**` or touching storage is Lane A, and both
lanes means Lane A's half first.

## Verification

Six adapter tests in `lib/data/postgres/__tests__/scale-declined-reading-reclaim.test.ts`, run
against a real Postgres rather than a mock because the fix is one SQL predicate: a dismissed row
confirms and its status changes, a pending row still confirms, an already-confirmed row is refused,
another account's dismissed row is refused, the list returns only this account's declines, and it
orders newest first while honouring its limit. Four route tests cover the response shape and that
the limit is bounded.

Mutation pass, exit codes captured directly:

| Mutation | Caught |
|---|---|
| confirm reverted to `pending` only | ✅ |
| `userId` scope dropped from the declined list | ✅ |
| status filter dropped from the declined list | ✅ |
| oldest-first instead of newest-first | ✅ |
| `limit` ignored | ✅ |
| **control** — `ne(status, 'confirmed')` instead of `inArray(['pending','dismissed'])` | correctly passed |

That control is worth keeping rather than just noting: over three statuses the two really are the
same set, and the tests cannot tell them apart because nothing distinguishes them. The explicit
`inArray` shipped anyway, because it stays correct the day a fourth status appears and the negation
does not.

**Not exercised: the S25.** Nothing renders the declined list yet, so there is no screen to look at —
the device check belongs with LA-108's Lane B half. What can be said is that the path is reachable:
the confirm route takes one of these ids unchanged.
