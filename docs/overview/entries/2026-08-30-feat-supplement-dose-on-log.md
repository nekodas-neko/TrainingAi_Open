# 2026-08-30 — the dose goes on the log (BF-3 gap 1), Lane A

**Branch:** `feat/supplement-dose-on-log` · **Lane A** · Postgres **244** + `claude_ro` **245** ·
local SQLite **v32** · patch version bump.

## Why this was urgent

The owner is about to start retatrutide. `supplements.dose` is free text on the **definition** and
`supplement_logs` carried no dose at all, so editing the dose rewrote history: titrate 2 mg → 4 mg →
8 mg and every past log retroactively read 8 mg. For a drug whose entire clinical story is the
escalation schedule, the escalation is exactly what was destroyed — and it could not be
reconstructed, because nothing recorded it. The entry's advice was to keep the schedule in a
spreadsheet until this shipped. That is no longer needed.

## What shipped

`supplement_logs` gains `amount`, `unit` and `dose_text`; `supplements` gains `default_amount` and
`unit`. All nullable, all additive, **nothing back-filled** — back-filling would stamp today's dose
onto history and manufacture the very claim this exists to stop.

**`dose_text` is the column that makes this work today.** Every existing supplement carries only
free text, so a structured-only fix would have required the owner to re-enter each one as a number
before their history was safe. The snapshot freezes the dose as it read, with no data entry and no
UI change.

`amount`/`unit` are the half the correlation ask needs — an exposure variable has to be a number on
a date — which is why the entry's *"id like it tracked well to correlate"* is now unblocked rather
than separate work.

## The chain, in one pass

Local table → `upsertSupplementLog`, which **stamps from the local definition when the caller omits
a dose** → outbox payload → `enrichPayload` at push time → `pushMutations` → `getSyncDelta` →
`pullDelta` → `applyDelta` → `listSupplements`.

Two of those deserve their own sentence.

**The store-side stamp is why today's UI needed no change.** `supplements-section.tsx` passes no
dose and does not need to; doing the stamp in the store rather than at the call site means the
shipped surface starts freezing doses immediately, and the Lane B work becomes *showing* the value
rather than recording it.

**The push enrichment closes the window the server fallback leaves open.** `logSupplement` falls
back to the definition's *current* dose when the payload carries none — correct for the web route,
where the log and the stamp are the same instant, and wrong for a mutation queued offline and
drained after a titration, which would write the new dose onto an old act. `enrichPayload` reads the
local row back, so the installed client gets this without changing.

`listSupplements` returns `loggedDose` **beside** `dose`/`defaultAmount`. A screen reading the
definition shows what you would take now; a log has to show what you actually took. Both are true and
they differ, which is the distinction the whole entry rests on.

## The chain gap TypeScript could not see

The `pullDelta` mapping in `sync-engine.ts` dropped all three columns and **compiled clean**, because
the fields are optional on `LocalSupplementLog` — optional so the Lane B call sites that build these
literals keep working. A fresh device would have pulled every past log and shown it at the
definition's current dose: the exact bug, reintroduced at the one point in the chain nothing checks.
Found by walking the chain rather than by the compiler, which is why CLAUDE.md says to walk it.

## The regression the dev server caught and the tests did not

The log route takes an **optional** body, and the first version treated only `no_body` as absent.
`fetch(url, { method: 'POST' })` and curl's `-X POST` both send `Content-Length: 0`, so the request
has a readable stream of zero bytes, `JSON.parse('')` throws, and the route **400'd every request the
shipped client makes**. The tests could not see it — they call the repository, not the route.

Fixed in `readJsonLimited` rather than by papering over it locally: zero bytes is now its own
`empty` reason, because *absent* and *malformed* need different answers and the helper was the only
place that knew the difference. Additive for every existing caller — they branch on `too_large` and
treat the rest as 400, which is what an empty body already produced. Two routes echo the reason
token into their 400 body (`feedback`, `scale-ble/samples`), so an empty body there now says
`empty` instead of `invalid_json`: same status, different string.

## Verified

22 tests across two files, 8 mutations, all killed: nothing stamped (the pre-fix behaviour, 9
failures), re-log not re-stamping, an explicit dose ignored (the offline-replay bug), the screen
reading the definition instead of the log, the sync delta dropping the dose, **the pull mapping
dropping it** (the gap actually found), the push enrichment unwired, and the local store no longer
stamping.

`pnpm dev` against the local Postgres — the sequence that is the entry's definition of done:

| Step | Result |
|---|---|
| create with `dose: "2 mg", defaultAmount: 2` | 201 |
| log with **no body** (what the shipped client sends) | **200** |
| titrate to 4 mg, then 8 mg | 200 |
| the earlier log | still **4 mg / "4 mg"** — unmoved |
| `GET /api/supplements` | definition `8 mg`, `loggedDose {4, mg, "4 mg"}` |
| log with an explicit `{amount: 6}` | stored as 6 |
| malformed / negative / unknown-key body | 400 / 400 / 400 |

Full suite **666 files / 5,583 tests** green; `pnpm check:rules` **Ran 62 of 62**; `tsc --noEmit`
clean; eslint clean.

## Not exercised

- **The device.** Local SQLite goes to **v32**, which is the highest-risk kind of change this repo
  has — a dead local store shows as an empty Nutrition tab. Not verified on the S25 and it needs to
  be: open Nutrition, confirm supplements list, tick one, force-close, reopen, confirm it is still
  ticked. **No new APK** — this is JS and reaches the phone through a Railway deploy.
- **Production data.** The dev check ran against a locally created supplement, removed afterwards.
- **Gaps 2 and 3** (multiple logs per day, weekly cadence) are untouched and stay queued, along with
  the Lane B surface — nothing in the UI enters or shows a dose yet.
