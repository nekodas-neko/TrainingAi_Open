## 2026-07-29 — Q-25: the unseeded activity type, and a weigh-in filed on the wrong day

**Branch:** `fix/q25-ingest-followups` · Q-25 (a) and (b) · **Q-25 closed**

Both were found during the on-server QA of Q-24 §7, neither caused by it.

### (a) One unknown activity type lost the whole flush

`activity_logs.activity_type` is a FK. A session whose type isn't a row in `activity_types` threw
out of `sync-health` and took every other record in the payload with it — the exact poison-pill
shape §7 had just closed for implausible records, arriving through a different door.

The client already maps Health Connect's exercise types to our slugs and falls back to `'other'`,
which is why this hadn't fired in production. But that mapping is a **client-side** table: it drifts
the moment a type is renamed or deleted server-side, and the failure mode is a 500 rather than
anything graceful. So the type is now resolved against the real table, server-side.

An unrecognised slug **degrades to `'other'`** rather than dropping a real session — a slightly less
precise activity type is a better outcome than a missing workout — and only degrades to a skip if
`'other'` itself is absent. Either way it's reported in `rejected[]`.

### (b) The scale filed weigh-ins under today, and the worse copy was the one not written up

The backlog entry named `/api/scale-ble/samples`. The sibling-surface sweep found
`/api/scale-ble/pending/[id]/confirm` had the same defect, and there it is not an edge case:

A pending reading is one the anomaly gate staged because it looked like someone else stepped on the
scale. It's confirmed whenever the owner next opens the app — hours or days later. Keying that write
on `todayInTz` meant the confirm filed against the wrong day nearly every time it ran, writing a
weight from last week onto today's row. Confirming the partner's reading would overwrite the owner's
current weight, which is precisely what the anomaly gate exists to prevent.

Both routes now key on the reading's own local day. They had carried byte-identical copies of the
composition→upsert block and drifted together, so it now lives once in
`applyScaleReadingToBodyMetrics` (`lib/scale-ble/apply-reading.ts`) — the extraction is the actual
fix for the drift, not a tidy-up alongside it. `measuredAt` is already clamped to a sane window by
§7's `resolveMeasuredAt`, so keying off it is safe.

### Verification

Full suite **2,746 passing, zero failures**; `tsc`, lint and `check-push-mutations` clean. 7 new
tests on the shared writer (own-day resolution, days-later confirm, a UTC-vs-Brisbane boundary at
23:00 UTC, the trend gate checking the reading's day, first-reading-wins, composition passthrough).

Exercised against a running `pnpm dev` with results read back from Postgres:

- `sync-health` with `activityType: "walking"` (unseeded) alongside a valid `"walk"` → **200**, both
  sessions stored, the unknown one as `other`, with
  `unknown activityType "walking", stored as "other"` in `rejected[]`. Previously: 500, both lost.
- `scale-ble/samples` with `measuredAt` 2026-07-27T22:30Z (08:30 Brisbane on the 28th) → filed on
  **2026-07-28**; 2026-07-29's existing weight untouched.
- A 61.2 kg reading against a last-confirmed 82.4 kg → staged `pending` as intended; confirming it
  **today** filed it against **2026-07-23**, the reading's own local day, leaving today's 82.4 kg
  alone. That is the partner-overwrite case, and it now doesn't happen.

Local seed rows touched during QA were restored afterwards.

### Not exercised

No APK run. Both scale routes are driven by the native `ScaleBleService`, and `sync-health` by the
Capacitor Health Connect aggregator.
