# Review — 2026-08-18 · sleep, readiness, heart-rate, body and devices: the ingest surface and input validation

_Section sweep, third of the day. These five pillars barely expose `[id]` write routes at all — they
are read-and-derive, and their writes arrive through **ingest** and **sync**. So the write-surface
lens used for workouts and nutrition does not reach them, and this is the lens that does._

_Findings: **Q-464, Q-465**. The headline is again a **clean** one: the ingest surface's auth model
and its value validation are both strong._

## Method, and what it does not establish

Three probes, all against `pnpm dev` on the seeded local Postgres as an authenticated user.

1. **Ingest auth model.** Every ingest/sync write route read for how it establishes identity, and
   specifically whether any accepts a `userId` from the request body.
2. **Value validation.** Physiologically impossible and out-of-range values sent at each ingest
   route — negative and absurd heart rates, out-of-range mood scores, impossible body weights,
   malformed sensor hex, far-past and far-future dates — checking both the status and **what actually
   landed in Postgres**.
3. **Schema strictness.** Counted how many request schemas reject unknown keys, then demonstrated the
   consequence on a real route.

**What this does not establish.** The **web** build and a fresh local seed: no device path, no native
SQLite, no real Health Connect or ring hardware, nothing about prod drift. The `health-connect/ingest`
route was read but **not called** — it is secret-authenticated and I did not have the secret, so its
validation is unverified by this sweep. The Oura BLE sample routes were likewise not exercised with
real frames. **Screens for these pillars are not re-covered here**: `/health/sleep`,
`/health/readiness`, `/health/heart-rate`, `/health/activity` and `/more/devices` were all rendered in
the 2026-08-17 failure-cells sweep with zero console errors and zero failing `/api/` responses, and
nothing since suggests re-rendering them would add anything.

---

## Q-464 — request schemas are almost never `.strict()`, and on a date-bearing write route that turns a mistyped key into a silent wrong-day write

**Severity: low-medium. Not a live bug — a footgun that converts a future typo into silent data
misplacement.** `[platform][body][nutrition]`

**Measured:** of **70** files defining a `z.object(...)` request schema across `app/api` and
`packages/shared/src/validation`, only **6** call `.strict()`. Zod's default is to silently drop
unknown keys.

**Demonstrated live** on `POST /api/body-metadata`:

| Sent | Response | Row written |
|---|---|---|
| `{"date":"2026-08-10","weightKg":81}` | `200 {"success":true,"date":"2026-08-18"}` | weight 81 on **2026-08-18** |
| `{"date":"3026-08-18","weightKg":81}` | `200 {"success":true,"date":"2026-08-18"}` | **2026-08-18** |
| `{"date":"not-a-date","weightKg":81}` | `200 {"success":true,"date":"2026-08-18"}` | **2026-08-18** |

The route itself is **correct** and should not be changed: it reads `body.localDate`, and when that is
absent it defaults to today in the user's timezone — exactly the documented pattern. The defect is
that `date` is not part of the contract, so the non-strict schema drops it and the write silently
lands on today. A caller who believes they are back-filling the 10th gets today's row overwritten,
with a success response.

**This is not currently reachable from the app's own clients** — they send `localDate`. It is filed
because the failure mode is silent and the repo has already paid for exactly this class once: the
`ai-chat` `localDate` regex that rejected every real request for a full release, which `CLAUDE.md`
documents at length. A strict schema turns that class of mistake into a 400 at the boundary.

**Eleven date-bearing write schemas are non-strict**, including `sync/push`, `health-connect/ingest`,
`running-plan`, `plan-meal-answers`, and the shared `body-metrics`, `activity-log` and `fitness-test`
schemas. `WorkoutEntryPatchSchema` is one of the six that *is* strict — the in-repo reference.

**Fix shape:** add `.strict()` to request schemas, starting with the date-bearing ones. Worth doing as
a sweep rather than opportunistically, and worth a CI rule afterwards — this is the same shape as the
hex-literal and TTL-divergence ratchets, which exist because prose alone did not hold the line.
**Lane A.** Note `sync/push` needs care: outbox payloads from an older APK may legitimately carry
fields the current schema does not name, so strictness there could reject mutations from a device that
has not updated. That one is the reason to do this deliberately rather than with a blanket codemod.

---

## Q-465 — `POST /api/day-checkin` creates a check-in row from a completely empty body

**Severity: low, and the consequence is unproven — stated that way deliberately.** `[readiness]`

`POST /api/day-checkin` with a body of exactly `{}` returns **201** and writes a row: every metric
column null, `sore_muscles` empty, no journal, `phase` defaulted to `'evening'`.

```
POST /api/day-checkin  {}   ->  201 {"id":"3c841f75-…","userId":"29f916c2-…"}
log_date    phase    physical_tiredness  mental_drain  hydration  sore_muscles
2026-08-18  evening  (null)              (null)        (null)     {}
```

An unknown field is also accepted and dropped — `{"sleepQuality":"banana"}` returned 201 and wrote
nothing for it, because `day_checkins` has no such column. That half is Q-464's class.

**What I could not demonstrate is harm, and I am not going to imply it.** The two consumers were
checked: `morning-checkin-sheet.tsx` pre-fills from a saved row but coalesces every field through
`?? NEUTRAL_SCALES`, so an all-null row behaves the same as no row; and `app/api/workout-data`
feeds the check-in into `reevaluationKey(...)`, where an empty row changes the key and can trigger a
re-evaluation carrying no new information. Neither is a user-visible bug I observed.

So this is filed as a **validation gap**, not a defect with a known symptom: a POST that asserts
nothing should not create a record asserting nothing, because the row is indistinguishable from a real
check-in where the user answered nothing — and readiness is the pillar where "the user told us
nothing" and "the user told us they feel neutral" must not be the same value.

**Fix shape:** require at least one meaningful field, or return the existing row unchanged when the
body carries no answers. **Lane A.**

---

## Clean — the ingest surface is in good shape, and this is the more useful half of the result

**1. No ingest route accepts a `userId` from the request body.** All ten checked
(`hr-ingest`, `oura-ble/samples`, `oura-ble/live-steps`, `oura-ble/battery-poll`, `scale-ble/samples`,
`body-metadata`, `mood`, `day-checkin`, `sync-health`, `health-connect/ingest`) derive identity from
the session, or — for `health-connect/ingest` — from a shared secret plus `WEBHOOK_USER_ID`. Two of
them (`oura-ble/samples`, `oura-ble/battery-poll`) additionally sit behind `requireAdmin`. There is no
route where a caller can name whose data they are writing.

**2. Value validation rejects physiologically impossible input, with useful messages.** Every probe
was rejected and **nothing landed in Postgres**:

| Sent | Result |
|---|---|
| heart rate `-50` | `400 {"error":"Invalid payload"}` |
| heart rate `99999` | `400 {"error":"Invalid payload"}` |
| mood/energy `999` | `400 {"error":"Invalid body"}` |
| mood/energy `-5` | `400 {"error":"Invalid body"}` |
| body weight `99999` | `400 {"error":"Too big: expected number to be <=500"}` |
| body weight `-40` | `400 {"error":"Too small: expected number to be >=20"}` |
| scale frame `rawHex:"zzzz"` | `400 {"error":"Invalid payload"}` |

The body-weight messages are the standout: they name the bound that was violated rather than saying
"invalid". `CLAUDE.md`'s rule that *"ingest routes get a Zod schema at creation… untyped numeric
passthrough to the driver is not validation"* is being followed on every route reachable here.

**3. The screens for these pillars were already clean** and are not re-reported: `/health/sleep`,
`/health/readiness`, `/health/heart-rate`, `/health/activity` and `/more/devices` all rendered with
zero uncaught page errors, zero console errors and zero failing `/api/` responses in the 2026-08-17
failure-cells sweep.

---

## Q-466 — CI re-downloads the Playwright browser on every E2E run

**Severity: low-medium. Free when the CDN is healthy; a hard block when it is not.** `[platform]`

Not from the ingest probe — observed while landing this run's PRs, and filed here rather than dropped.

`.github/workflows/ci.yml:391-392` runs `npx playwright install --with-deps chromium` on every E2E
run with no cache. `actions/setup-node`'s `cache: 'pnpm'` covers the pnpm store, **not**
`~/.cache/ms-playwright`, so each run pulls ~150 MB of Chromium afresh.

**Observed twice on 2026-08-18** — PR #47 and PR #66, out of roughly 6–8 E2E runs that day, so the
*rate* is indicative rather than measured. Both times the step sat `in_progress` for 6–22 minutes with
every other job green, and had to be cancelled and re-run; the re-run finished the same step in under
a minute. The tell: `Install Chromium` `in_progress` while `Run pnpm e2e` is still `pending` means the
download, not the specs.

E2E is a **required check**, so this blocks the merge rather than degrading it, and each recovery costs
~20 minutes. **Fix shape:** `actions/cache` on `~/.cache/ms-playwright` keyed on the resolved
`@playwright/test` version. Keep the install step — it must still run on a cache miss — and leave
`playwright.config.ts`'s sandbox-binary preference alone; its comment explains why CI needs the
install at all.

## Section coverage — complete

With this sweep every pillar has now been reviewed at least once in this run:

| Pillar | Lens applied |
|---|---|
| `workouts` | write path cross-user + live drive (Q-460…Q-462) |
| `nutrition` · `cardio` · `activity` | writes cross-user + app-wide not-found probe (Q-463) |
| `sleep` · `readiness` · `heart-rate` · `body` · `devices` | ingest auth, value validation, schema strictness (Q-464, Q-465) |
| `app-shell` · `platform` | failure cells, repo-migration architecture (Q-450…Q-459) |

What is deliberately still open, and recorded in the baton: the **device runtime** (nothing in any of
these sweeps left the web build), **production data** (`claude_ro` was never queried), the
**offline/error paths**, and the secret-gated `health-connect/ingest` validation.
