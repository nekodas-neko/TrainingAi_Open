# 2026-08-30 — the weigh-in buttons work now (BF-53), Lane A

**Branch:** `fix/pending-weighin-numeric-id` · **Lane A** · no migration · user-visible fix, patch
version bump.

## What was wrong

`scale_raw_samples.id` is a `bigserial`, and both pending-reading routes ran `invalidUuidResponse`
over it. A decimal id can never match a UUID regex, so **every** press of "Not me" or "Yes, that's
me" returned `400 Invalid id` — the whole pending weigh-in triage was dead in production. A reading
that was not the owner's could not be dismissed; one that was could not be confirmed into
`body_metrics`.

The correct `Number.isInteger` check sat unreachable on the next line, which is the tell: whoever
wrote these knew the key was numeric, and the sweep that added `invalidUuidResponse` across the 30
dynamic `[id]` routes (Q-482) applied the UUID guard over the top of it.

**The client is why it survived.** `dismissReading` was `if (res.ok) setPending(…)` with no `else` —
no toast, no log — so a 400 was indistinguishable from a button doing nothing, which is exactly how
the owner reported it: *"the 'not me' button for weigh in's doesnt actually remove it or do
anything."*

## The fix

`numericRouteId` in `lib/api/route-errors.ts`, beside `invalidUuidResponse` and for the same reason
that one exists: so the **next** sweep over `[id]` routes finds a numeric key already guarded, by a
name that says so. It returns `{ ok, id }` so a caller cannot forget to parse.

It uses `/^\d+$/` rather than `Number.isInteger(Number(x))`. The latter — the guard that sat
unreachable underneath — accepts `'1e3'`, `'0x10'`, `' 41 '` and `'0'` as ids, none of which a
`bigserial` column ever produces.

Both handlers in `scale-pairing.tsx` now report a failed press through the error line the component
already renders. That half stands on its own: the route bug is fixed, and a future one will not be
invisible.

## The sweep, complete

`invalidUuidResponse` is used by 29 route files. Ten tables in `schema.ts` have a non-uuid primary
key, and five repository methods take `id: number`. Cross-referencing them: **these two routes were
the only pair**, and no other dynamic route reaches a non-uuid table.

`numeric-route-id-guards.test.ts` freezes that — it derives the number-keyed methods from
`repository.ts` (never a hand-list) and fails if any route calls one behind `invalidUuidResponse`.

## Verified

23 tests. The route tests are **DB-backed against real `bigserial` ids**, which is the point: a test
posting a UUID would have passed the old guard and 404'd, and read as correct. That is why the
existing coverage could not have caught this.

`pnpm dev`, against the same real pending row:

| | pre-fix | post-fix |
|---|---|---|
| `POST …/349/dismiss` | **400 Invalid id**, row untouched | `{"status":"dismissed"}`, row `dismissed` |
| `POST …/350/confirm` | **400 Invalid id**, row untouched | `{"status":"confirmed","weightKg":73.9}`, 73.9 kg in `body_metrics` |
| `abc` / `1e3` / `0` / `-1` | 400 | 400 |
| id that is not there | — | 404 |

Mutation-proven, anchors asserted first — five mutations, all killed: the loose
`Number.isInteger` guard restored, `0` accepted as an id, the UUID guard restored on dismiss (fails
7 cases, including the sweep test), the silent `if (res.ok)` restored on the client, and the file
clobber below.

## A mistake worth recording, because the tests did not catch it and the app would have

Mid-session the mutation-testing harness backed files up as `/tmp/$(basename $f).bak`. **Every Next
route file is named `route.ts`**, so `confirm/route.ts` and `dismiss/route.ts` collided on one
backup path and the restore wrote confirm's contents over dismiss. The two files went byte-identical.

The symptom on the dev server was `POST …/dismiss` returning `{"status":"confirmed"}` and flipping
the row to `confirmed` — **"Not me" confirming the reading**, which is strictly worse than the bug
being fixed. It took four measurements to attribute, because the obvious readings (a stale dev
server, a Turbopack routing bug, a duplicate process) all had to be ruled out first; the Next dev log
showed it compiling the right file, which made it look like a framework fault rather than a
self-inflicted one.

Two things came out of it. The DB-backed route test **does** catch it — but it skips in CI, so a
source-level case now asserts that dismiss calls `dismissScaleSample`, that it does not call
`confirmScaleSample`, and that the two files differ. And the general lesson: in this repo a backup
path keyed on a basename is unsafe, because `route.ts`, `page.tsx` and `layout.tsx` are all
non-unique by design.

## Not exercised

- **The device.** BF-53 stays in the queue with a `Keep:` for the S25 pass: a pending reading
  dismisses and disappears, a confirmed one reaches the weight card, both stay gone across a screen
  swap. The APK reaches this through a Railway deploy — no new build.
- **Production data.** The dev check ran against locally seeded pending rows, removed afterwards.
- **The BLE staging path** that creates a pending row was not exercised; the rows were inserted
  directly, which is what makes the ids realistic `bigserial` values.
