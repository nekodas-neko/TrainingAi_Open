# 2026-08-19 — a discarded weight now says so (Q-485)

**Lane A** · branch `fix/push-coercion-visibility` · no migration, no Kotlin, no APK.

Same value, same field, same instant:

```
POST /api/body-metadata  →  400  {"error":"Too big: expected number to be <=500"}
POST /api/sync/push      →  200  {"processed":1,"errors":[]}   → weight_kg NULL
```

**The bounds were never the problem and were not touched.** Both paths import the same
`packages/shared/src/validation/body-metrics.ts`, so they cannot drift — *One Formula, One Place*
holding. What differed was the *answer*. The push branch's comment claiming it "matches the web
route's numeric bounds" is accurate about bounds; it just never described behaviour.

The drop was invisible in all three places it could have been recorded: no `errors[]` entry, so the
client confirmed the mutation and deleted it; no `console.*` in the coercion block; no `error_events`
row. A value the web refuses with a clear message was discarded on the canonical runtime with no
trace and no way for the user to know.

## What changed

The 14 inline `typeof x === 'number' ? validXOrNull(x) ?? undefined : undefined` expressions became
one `bounded(name, value, validator)` helper that **records what it discards**. Fewer lines, and the
field name is now available where before it was thrown away with the value.

- **`console.warn` with the date and every dropped `field=value`** — makes the condition diagnosable
  at all, which it was not.
- **A `warnings[]` channel on `PushResult`**, separate from `errors[]`. This is the part that matters:
  `errors[]` dead-letters the mutation, and a discarded *field* is no reason to throw away the fields
  that landed. The client ignores `warnings` for confirm/delete, so nothing quarantines.
- **One `error_events` row per push**, same bound as the retryable report added in Q-487 — so this
  now reaches the table the session-start ritual reads, which is the whole point of Q-487 landing
  first.

## What it deliberately does NOT do

**It does not throw.** A throw quarantines the mutation, and the poison-pill rule forbids retrying a
validation failure forever, so twelve new throw sites would trade an invisible failure for a queue of
red badges over values the user cannot correct from a badge.

Deciding *per field* which values are "incomplete, keep going" and which are "meaningless,
quarantine" is a product call — the entry said so outright, and it is right. `waterMlDelta` and
`sleep_session` throw today and both are defensible for reasons specific to them. Filed as **Q-321**,
blocked on the owner; the mechanism is built, only the policy is missing. Nothing renders `warnings[]`
yet either, and that is Lane B's half, which should follow the policy rather than precede it.

## Live

```
web   POST /api/body-metadata  {"weightKg":10000}  → 400 "Too big: expected number to be <=500"
push  POST /api/sync/push      same value          → 200 processed:1, errors:[]
       warnings: [{"id":"m1","domain":"body_metrics","warning":"Out-of-range value(s) discarded: weightKg=10000"}]
       row:      steps=7000  weight_kg=NULL
       error_events: sync/push: 1 mutation(s) had a value discarded — first: … weightKg=10000
```

The sibling field still lands and the mutation still reports processed — the fix must not cost the
data that was fine.

Five tests cover: valid fields still written and not dead-lettered, the field named with its value
and keyed by mutation id, **every** dropped field reported rather than the first, silence when
everything is in range, and an omitted field treated as absent rather than discarded.

Full suite 505 files / 4133 tests green.

## A trap the entry flagged, restated because it will be reached for again

**Production cannot adjudicate this.** 35 of 114 `body_metrics` rows have steps and a NULL weight,
and that is the *expected* shape — steps arrive daily from the ring, weight only when the owner uses
a scale. It is not evidence of coerced-away weights. Same trap as Q-460's "74% lack an RPE".

## Not exercised

The APK. The client half (`errors: []` → confirm → `deleteMutations`) was read from `sync-engine.ts`
rather than induced. Domain branches outside `body_metrics` were not enumerated for the same pattern.
