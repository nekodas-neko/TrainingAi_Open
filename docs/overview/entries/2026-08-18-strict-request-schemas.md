# 2026-08-18 — an unknown request key is a 400, not a silent drop (Q-464)

**Lane A** · branch `fix/strict-request-schemas` · one schema + a CI ratchet · no migration, no
Kotlin, no APK.

Zod drops an unknown key by default, so a mistyped or wrong-named field became a **successful write
of the wrong thing**. Of 70 files defining a request schema across `app/api` and
`packages/shared/src/validation`, only 6 called `.strict()`.

Demonstrated on `POST /api/body-metadata` — the contract's key is `localDate`, so `date` was
discarded and the write landed on today:

| Sent | Before | After |
|---|---|---|
| `{"date":"2026-08-10","weightKg":81}` | `200`, weight on **2026-08-18** | `400 Unrecognized key: "date"` |
| `{"date":"3026-08-18","weightKg":81}` | `200`, weight on **2026-08-18** | `400` |
| `{"date":"not-a-date","weightKg":81}` | `200`, weight on **2026-08-18** | `400` |
| `{"localDate":"2026-08-18","steps":7777}` | `200`, written | `200`, written |

After: the row's weight is **NULL** where three bogus writes previously landed.

## Two corrections to the entry, both found by implementing it

**It IS a live bug.** The entry says *"not a live bug — the app's own clients send the right keys"*.
They do not. `MetaKey` includes `waterIntake`, and the Water widget's **web fallback** posts
`{localDate, waterIntake}` to `/api/body-metadata` — which names no water field at all, because water
lives on `/api/water-log`. Measured: `200 {"success":true}` with `water_ml` still NULL, against a
`steps` control that wrote fine. Filed as **Q-472** (Lane B, the client's file). Strict turns that
silent loss into a visible failure, which is the point — the value was being lost either way.

**The `sync/push` caveat is far wider than one route.** The entry singles out `sync/push` as needing
care because an older APK's outbox payload may carry fields the current schema does not name. That
argument applies to **every schema `pushMutations` parses** — `activity-log`, `fitness-test`,
`day-checkin`, `oura-summary`, mood, food-item, log-exercise, session-rpe, complete-workout — because
an outbox payload is written to local SQLite by whatever bundle was current when the user acted and
sits there until the device syncs. Tightening any of those can dead-letter real data. Plus
`health-connect/ingest`, whose client is the owner's Tasker profile and is not in this repo.

Both classes are **named with their reasons in the script's header**, not silently skipped.

## What shipped

- **`BodyMetadataPostSchema` is `.strict()`** — verified safe first: both POST clients
  (`metric-log-sheet.tsx`, `log-value-sheet.tsx`) send `{ localDate, <field> }` and nothing else, and
  every field key they can send is in the schema except the already-broken `waterIntake`.
- **`scripts/check-strict-request-schemas.js`**, in the Custom Rules job — now **39 steps**, and the
  runner picked it up from the YAML rather than needing a hardcoded count, which is the point of that
  design. Shrink-only per-file baseline, same shape as `check-hex-literals` and
  `check-cache-ttl-divergence`: a file not listed must have zero, a listed one may only shrink, and
  reaching zero requires deleting its row. `--print` reproduces the count from a shell, so the
  baseline is checkable rather than trusted.

It caught its own improvement during development — flipping one schema made it fail with *"is in the
baseline but now has none — delete its row"*, which is the behaviour that keeps a gain from silently
eroding.

## Verification

- **4 new schema tests**: the three measured wrong-day payloads rejected, `waterIntake` rejected, a
  typo'd known key (`weightkg`) rejected — and a companion test asserting **every key the two real
  clients can send is still accepted**, with a plausible value per field so it fails on strictness
  rather than on a bounds check.
- **Live on `pnpm dev`**: all four wrong-key bodies → `400` naming the key; the valid one → `200`
  and written; weight NULL afterwards.
- `pnpm check:rules` **39 of 39** · `tsc --noEmit` clean · full suite green.

## Failure surfaces NOT exercised

- **89 non-strict schemas remain** and are deliberately untouched. Each needs its clients checked the
  way this one's two were; the ratchet is the mechanism, the sweep is separate and much larger —
  exactly what `check-hex-literals` says of its own 471.
- **The heuristic is textual.** It counts `z.object(` occurrences not followed by `.strict()`, so it
  also counts nested and non-request objects in those files. Kept simple and reproducible on purpose;
  the baseline is a ratchet, not a census.
- No device, no Kotlin, no APK.
