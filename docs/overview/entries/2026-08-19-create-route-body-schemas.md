# 2026-08-19 — the create routes got the bounds their PATCH siblings already had (Q-484)

**Lane A** · branch `fix/create-route-body-schemas` · no migration, no Kotlin, no APK.

`POST /api/injuries` had **no schema at all** while `PATCH /api/injuries/[id]` beside it had a
complete one — same table, same fields. Measured before:

```
POST /api/injuries     muscleName 200,002 chars + notes 500,000  →  201, both stored in full
POST /api/injuries     notes 10,000,000 chars (a 10 MB body)     →  201, 10,000,000 stored
POST /api/supplements  name 300,002 chars + dose 100,000         →  201, both stored in full
POST /api/injuries     {"startedDate":"not-a-date"}              →  500
```

All four are **400** now, and an ordinary create still returns 201.

## The asymmetry was the finding, so the fix removes the ability to have one

The obvious repair is to paste the PATCH bounds into the create route. That leaves two definitions
that can drift apart again — which is exactly what happened here. `CLAUDE.md` names `updateInjury` as
*the reference* for Zod-whitelisting a body, and it is a good one; the rule was written about edit
paths after an edit-path bug, and the create path beside it was never revisited.

So both now come from **one** definition — `packages/shared/src/validation/{injury,supplement}.ts`
exports the patch schema and the create schema from a shared field map. Create requires what the row
cannot be written without; everything else keeps the patch bounds. Three tests assert the two refuse
the same values and accept the same largest value, so widening one without the other fails.

## An existing CI rule caught a latent bug the moment the code moved

Moving the regex into `packages/shared/src/validation/` brought it into the scope of
`check-date-param-regex.js`, which failed on `/^\d{4}-\d{2}-\d{2}$/`. It was right: the client's
`localDateString()` emits **`YYYY/MM/DD` with slashes**, and a dash-only regex rejects every such
request with a Zod error *before the handler runs* — the failure that bit `ai-chat`'s `localDate` for
a full release.

Nothing was broken today, because the injury clients use `todayInTz()` (dashes). That is the point:
the failure mode is silent until some client fills the field from the other helper.

Both schemas now accept `[-/]`, and **both handlers normalise slashes to dashes before the write** —
the columns are `DATE`, and `2026/08/09` is DateStyle-dependent at the driver, so it must not reach
it as-is. Verified live: `{"startedDate":"2026/08/09"}` → 201, stored as `2026-08-09`.

`app/api/injuries/[id]/route.ts` was on that check's GRANDFATHERED list and is genuinely fixed, so
its row is deleted rather than left to rot into an allowlist.

## What is deliberately left

A 10 MB body is now rejected — **but still parsed into memory first**, because the rejection happens
in Zod, after `req.json()`. The transfer-and-parse cost is unchanged; only the storage is bounded.
That, plus the **31** other `req.json()` routes with no `safeParse` (a *candidate* count, not a defect
count — several do hand-rolled checks, several are admin-gated), is filed as **Q-322**: a shared
bounded reader first, so all 33 are capped before anyone audits them individually.

## Priced honestly

Not attack — this app's users are its own account holders, `claude_ro.injuries` is **empty**, and
`supplements` holds 2 rows with a 9-character max name. It is worth doing because `CLAUDE.md` runs a
session-start database-size ritual and records a real `disk_full` outage, and an unbounded
user-writable text column is the shape that ritual exists to catch — and because the stated direction
is multi-user + Play Store, at which point "nobody is attacking it" stops being an argument.

**Do not quote 10 MB as a storage figure.** `pg_column_size` read ~120 kB for the probe rows because
the payload was one repeated character and TOAST compressed it almost perfectly. Real text would not.

Full suite 506 files / 4144 tests green; Custom Rules 46 of 46.

## Not exercised

Production, and the APK. The offline sync path for these domains has its own validation and was not
re-probed.
