# 2026-09-22 — a dropped key is now a 400 that names it, and the outbox deliberately stays lenient

**Branch:** `lane-a/la128-strict-checkin-body` · **Agent:** Implementation (Lane A) ·
**Code + docs.** No user-visible change, so no version bump.

`POST /api/day-checkin` built its `Body` with `.extend()` and never called `.strict()`, so Zod
dropped a key it did not know instead of refusing the body: a sheet posting a field whose server
half had not landed got **201 and wrote nothing**. LB-124 was filed rather than attempted over
exactly this — it would have burned TN-58's two-week pass test and reported "no self-report
available" when the truth was a dropped field.

## The entry's open question, answered before touching anything

It said plainly: *"Not established: whether any current client actually sends an unknown key. Nobody
looked — the shape was found by reading the schema, not from a failure. Start there: it decides
whether this is a one-line change or a three-file one."*

Checked key by key. **No current client sends one.** The morning sheet sends 13 keys, the evening
review 9, all known. The three "retired scales" look like the obvious landmine and are not:
`motivation`, `restingSoreness` and `wakeMood` are retired from the UI but still in
`DayCheckinScalesSchema`, and the sheet sends them as null on purpose so a re-save clears a
historical value. So: one line, and the entry's blast-radius warning does not materialise.

## The outbox is the opposite of what the entry assumed

The entry treats `pushMutations` as the **risk** of stricting — *"on the outbox path that is a
no-retry poison pill"*. Measured, the outbox never touches the route's `Body` at all. It is
`lib/data/postgres/adapter.ts`, which `safeParse`s `DayCheckinScalesSchema` and
`DayCheckinExtrasSchema` **separately and non-strictly**, then calls `saveDayCheckin` with a
hand-written field list. An unknown key there is dropped by the explicit mapping — the same silence,
on the path the device actually uses, since the POST only fires when the local write fails.

So my first instinct was to strict both. **That is wrong, and the reason is worth keeping.** An
outbox item is rejected per-item and never retried, so a strict failure there does not surface a
mistake — it deletes a check-in the user already wrote, turning a partial save into no save. Worse
on a queue that may hold an older payload shape from before an app update.

And the asymmetry is justified rather than merely tolerable: the outbox path is **already gated**.
A new field must pass `store.upsertDayCheckin` and the local SQLite column list before it can reach
the server, which is why LB-124 needed a local migration. It cannot arrive unnoticed the way a POST
body can. The route has no such gate, which is why the route is the half that needed `.strict()`.
That reasoning is written into `adapter.ts` beside the lenient parse, because the next reader will
see the mismatch and want to "fix" it.

Stricting either shared schema on its own would also reject everything outright: each is parsed
against the whole payload, so the scales schema sees `journal`/`soreMuscles`/`phase` and the extras
schema sees the ten scales. The entry's fear was real, just attached to the wrong change.

## The 400 names the key

`Invalid body` alone sends the developer looking at the values they sent rather than the key they
added. Zod 4 reports `unrecognized_keys` with the names, so the response is
`Unknown field(s): moodAfterCoffee`. A value failure still reads `Invalid body`, and there is a case
pinning that the strict branch did not swallow the ordinary validation errors.

## Verification

- 7 route tests, including both live client payloads copied verbatim — so if someone adds a field to
  a sheet without the server half, these go red rather than the field vanishing.
- **4 mutations caught, 1 equivalent control** (reordering the two `.extend()` lines — correctly not
  caught).
- **Driven over HTTP against `pnpm dev`** with a real session, which is the part the unit tests
  cannot prove:

| probe | result |
|---|---|
| unknown key | **400** `Unknown field(s): moodAfterCoffee` |
| two unknown keys | **400** `Unknown field(s): alpha, beta` |
| bad *value*, not key | **400** `Invalid body` |
| morning sheet payload verbatim | **201** |
| evening review payload verbatim | **201** |
| `phase` omitted | **201**, defaulted to `evening` |
| empty body | **400** `Check-in carries no answers` (Q-465 intact) |

- **The defect was observed, not just asserted.** With `.strict()` removed the same unknown-key body
  returned **201** and the row came back with the key absent. (`perceivedRecovery` also read null
  there, which is *not* a bug — I omitted its `touched` flag, so TN-57's guard correctly refused to
  store a seeded value as a self-report.)
- `pnpm check:rules` **75 of 75** · `tsc --noEmit` clean · full suite **9,326 passed, 87 skipped**.

**Not exercised:** the outbox path itself was read, not run — no queued mutation was pushed through
`pushMutations` in this session, because nothing in the diff changes its behaviour. Nothing was
verified on device.
