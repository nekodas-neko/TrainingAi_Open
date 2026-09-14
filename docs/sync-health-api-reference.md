# Sync-Health API Reference

_For someone connecting their own device/data to this app. This is the real request/response
contract for `POST /api/sync-health`, taken directly from the Zod schema in
`app/api/sync-health/route.ts` — not paraphrased. If this doc and the code ever disagree, the code
wins; re-read the route before trusting a stale copy of this file._

**Read the honesty note in §4 before writing any code.** The short version: this endpoint works and
is real, but it was built for the app's own in-app sync, not as a public integration API — there is
no API-key auth for it today, only a login session. §4 explains what that means for you and the
better option if your device already shows up in Android Health Connect.

---

## 1. Endpoint

```
POST /api/sync-health
Content-Type: application/json
```

- **Auth:** a valid NextAuth session cookie for the account the data belongs to (see §4).
- **Rate limit:** 60 requests / 60 seconds per user.
- **Body size limit:** 1 MB.
- Every array below is **optional** — send only what you have. Send `{}` for a no-op call.
- Every object in every array is `.strict()` — **an unrecognized field is rejected** (the whole
  request 400s), not silently dropped. Don't send extra fields "just in case."
- **Rejections are per-record, not per-request.** A record that fails a plausibility check (§3) is
  skipped and named in the response's `rejected` array; the rest of the batch still saves. You will
  never lose an entire sync because one record looked physiologically impossible.

## 2. Request body

```ts
type SyncHealthRequest = {
  dailyMetrics?:     DailyMetric[]      // max 400 entries
  exerciseSessions?: ExerciseSession[]  // max 400 entries
  sleepRecords?:     SleepRecord[]      // max 400 entries
}
```

### 2a. `dailyMetrics` — one entry per calendar day, sparse

```ts
type DailyMetric = {
  date: string                    // REQUIRED. "YYYY-MM-DD" or "YYYY/MM/DD" — both accepted
  steps?: number                  // integer, 0–200000
  distanceKm?: number             // 0–500
  caloriesBurned?: number         // 0–20000
  weightKg?: number               // 0–500
  bodyFatPct?: number             // 0–100
  calories?: number               // 0–20000 — this is FOOD/INTAKE calories, not burned (name carried over from the Health Connect nutrition record type — don't be misled by it)
  proteinG?: number               // 0–2000
  carbsG?: number                 // 0–2000
  fatG?: number                   // 0–2000
  restingHeartRate?: number       // integer, 20–300
  hrvMs?: number                  // 0–1000
  spo2Pct?: number                // 0–100
}
```

**Every field except `date` is optional.** There is no `null` — omit a field entirely rather than
sending `null` or `""` for it (an explicit `null` fails validation; this schema wants the key
absent, not nulled). Send whatever your device actually measured; the app's ranked provenance merge
lets a later, better-sourced value overwrite a field without touching the others on the same day.

**One entry per `date` per call is the expectation, but multiple days in one call is fine** — send a
week's worth of daily metrics in one `dailyMetrics` array if you're syncing periodically rather than
in real time.

### 2b. `exerciseSessions` — one entry per workout/activity session

```ts
type ExerciseSession = {
  date: string                    // REQUIRED, same format as above — the session's local calendar day
  title: string                   // REQUIRED, 1–200 chars, e.g. "Morning Run"
  activityType: string            // REQUIRED, 1–100 chars — see the allowed values below
  startTime: string                // REQUIRED, "HH:MM" 24-hour, e.g. "06:30"
  endTime: string                  // REQUIRED, "HH:MM" 24-hour, e.g. "07:15"
  durationMin: number             // REQUIRED, 0–1440
  distanceKm?: number             // 0–500
  caloriesBurned?: number         // 0–20000
  avgHr?: number                  // integer, 20–300
  maxHr?: number                  // integer, 20–300
}
```

**`activityType` must be one of the app's known slugs, or it silently stores as `"other"` instead of
being rejected** (the route resolves it server-side against the real table so an unrecognized slug
never drops the whole session). Known slugs today: `walk`, `run`, `cycle`, `hike`, `swim`, `yoga`,
`stretch`, `hiit`, `other`. Send `"other"` directly if nothing else fits — you'll never get a 400
for this field specifically.

**Deduplication is on `(date, startTime)`.** Sending the same session twice (e.g. on every periodic
sync, because your device doesn't track what it already sent) is safe — the second copy is silently
skipped, not double-counted.

**Plausibility rejection (a record can fail and get skipped even if the shape is valid):**
- `avgHr`/`maxHr` outside roughly 20–300 bpm
- `maxHr` below `avgHr`
- implied speed from `distanceKm`/`durationMin` too high to be human
- implied calorie burn rate too high
Each failure is named in the response's `rejected` array as a plain string, e.g.
`"exercise 2026-09-14 06:30: avgHr 340 is outside 20-300 bpm"`.

### 2c. `sleepRecords` — one entry per sleep session

```ts
type SleepRecord = {
  date: string                    // REQUIRED — the WAKE-UP date, not the date you fell asleep
  sleepStart: string              // REQUIRED — any string Date() can parse; send full ISO 8601, e.g. "2026-09-13T22:15:00.000Z"
  sleepEnd: string                // REQUIRED — same format
  durationHours: number           // REQUIRED, 0–24
  deepSleepHours?: number         // 0–24
  remSleepHours?: number          // 0–24
  lightSleepHours?: number        // 0–24
  awakHours?: number              // 0–24
  sleepPhase5Min?: string         // optional — see below
}
```

**`sleepPhase5Min` is the one field worth extra care.** If your device exposes a stage-by-stage
timeline (start/end/stage triples), reduce it to one character per 5-minute bucket across the
night: `1` = deep, `2` = light, `3` = REM, `4` = awake. Regex `^[1-4]+$`, max 288 characters (24
hours at 5-minute resolution). **If you don't have real stage boundaries, omit this field entirely**
— don't send a flat/guessed string just to fill it in; a fabricated hypnogram is indistinguishable
from a real one downstream and actively misleads the sleep-scoring formula. `deepSleepHours` etc.
(stage *totals*, no timeline needed) are enough on their own if that's all you have.

**Plausibility rejection:**
- `sleepEnd` before `sleepStart`
- stage-hour totals exceeding the actual `sleepStart`→`sleepEnd` span by more than 30 minutes
- `durationHours` exceeding that span by more than 30 minutes
- an unparseable `sleepStart`/`sleepEnd` string

## 3. Response

```ts
type SyncHealthResponse = {
  ok: true
  enrichmentCandidates: { id: string, date: string, startTime: string, endTime: string }[]
  rejected: string[]   // one human-readable string per skipped record; empty array if everything saved
}
```

`enrichmentCandidates` is informational — it lists your own recent activity-log entries that are
still missing HR/distance/calories, in case your sync pipeline wants to backfill them on a later
call via `PATCH /api/activity-logs/[id]/metrics`. You can ignore it if your device doesn't do
after-the-fact enrichment.

**Error responses:**
| Status | Meaning |
|---|---|
| `401` | No valid session |
| `429` | Rate limit hit (60/min) |
| `400` | Malformed JSON, or the body failed schema validation — check `issues` in the response for exactly which field |
| `413` | Body over 1 MB |

## 4. The honest part — auth, and what to actually do

**This endpoint is real and already receives real device data — but it was built for the app's own
Health Connect sync running inside the app itself, authenticated by the same login session as
everything else. There is no API key or access token system for external scripts today.** To call
this endpoint directly, something would need to hold a valid session cookie for your account, which
isn't a workflow this app currently exposes cleanly for outside use.

**Two real paths, in order of how much work they need:**

1. **If your device (or its companion app) already writes into Android Health Connect** — this is
   true for a lot of wearables — **you need zero custom code.** Create your own account in this app,
   grant it Health Connect permission on your phone, and the app's existing sync
   (`lib/health-connect-sync.ts`) picks up your data automatically, going through this exact
   endpoint under the hood. This is the path worth trying first.
2. **If your device doesn't reach Health Connect at all** and you genuinely want to run your own
   script/bridge against this API, that needs a small feature that doesn't exist yet: a per-user API
   key or access token, separate from the login session, scoped to exactly this kind of write. That's
   real, scoped work — not something to hack around with a copied session cookie, which expires and
   isn't meant for this. It's been filed as **PS-45** in `docs/implementation-backlog.md` so it's not
   lost; it needs the app owner's sign-off before it's built, since it's new authentication surface.

If path 1 doesn't apply to your device, say so and the owner can prioritize PS-45.

---

## References

- [`docs/data-source-connector-guide.md`](data-source-connector-guide.md) — the broader design this
  endpoint is one piece of: what data types feed what scores, and how a new device fits in
  architecturally.
- `app/api/sync-health/route.ts` — the actual route this doc describes. Re-check it if anything here
  looks wrong; this file is a description, the route is the truth.
- `packages/shared/src/validation/plausibility.ts` — the exact rejection rules in §2b/§2c.
