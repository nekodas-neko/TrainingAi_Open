# Oura Direct-BLE Phase 3+4 (MVP) — Decode history events + store HR in the DB

**Goal (owner-stated):** by the end of this session, drained ring history is **decoded and stored
in Postgres**, so we can prove we're recording HR (and the other core signals). Plus: **rebuild the
`/admin/oura-ble` screen into a solid, minimal tester UI**.

**Predecessor:** [`2026-07-07-oura-ble-phase-2-results.md`](2026-07-07-oura-ble-phase-2-results.md)
(Phase 2 PASSED — GO). **Source of truth for decode bytes:** open_oura's Rust
`crates/oura-protocol/src/events.rs` `decode_body` (the skill's own rule: source, not docs).

## Scope decisions (deliberate, to hit the deadline correctly)

- **Decode server-side in TypeScript**, not Kotlin. The native plugin already streams raw event
  frames to JS (`ouraFrame`); JS POSTs them; the server decodes + stores. Faster than a Kotlin
  decoder port, unit-testable in the existing suite, and keeps the native side unchanged. (A later
  session can move decode native-side per the skill's porting map if perf demands it.)
- **Server-side ingest path, NOT a new offline-first outbox domain.** This mirrors the existing
  Oura Cloud sync (`/api/oura/sync` → `oura_daily`) and Health Connect ingest — external device
  data read then written to Postgres server-side. Durability comes from the **ring's history cursor
  (RE9)**: a failed POST doesn't advance the cursor, so the next drain re-pulls. No outbox needed.
  (The full offline-first `oura_raw_samples` local-store mirror stays deferred to a later Phase-4
  increment, exactly as the Phase-2 plan scoped it.)
- **Store raw events, re-decodably.** One row per raw ring event: `(tag, ring_timestamp_ds,
  body_hex, decoded jsonb)`. This is `oura-store`'s model — preserves everything and supports the
  skill's offline re-decode path (fix a decoder later, re-run over stored `body_hex`).
- **MVP signal set:** HR (IBI `0x80`, `0x60`), temperature (`0x46/0x69/0x75`), HRV (`0x5d`), SpO₂
  (`0x6f`, `0x8b` R/PI), battery-debug (`0x61/0x24`), time-sync (`0x42`), sleep phases
  (`0x4b/0x4e/0x5a`). **Deferred:** MET/activity, motion periods, CVA raw PPG, our own scores.

---

## Task A — `lib/oura-ble/decode.ts` (pure, TDD)

Port `decode_body` from `events.rs` byte-exact. Infallible (unknown → `null`, RE11).

- `parseFrame(bytes)` → `{ tag, payload }` (mirror `OuraProtocol.parseFrame`, lenient len).
- `parseHistoryEvent(frame)` → `{ tag, name, timestampDs, bodyHex, decoded }` for `tag >= 0x41`
  (timestamp = payload[0..4] LE; body = payload[4..]; `decoded = decodeEventBody(tag, body)`).
- `decodeEventBody(tag, body)` dispatch + per-tag decoders, each pinned to the **captured test
  vectors** already in `events.rs` tests:
  - `0x80` green IBI/quality: `ibi = (b1 & 7) | (b0 << 3)`, `q = (b1>>3)&3`, `hr = 60000/ibi` when
    `q==1 && 300<=ibi<=2000`. Vector `9d09940b9d0d9a099a09a62e946e` → 7 IBIs, `ibi[0]=1257`.
  - `0x46/0x69/0x75` temps: i16 LE centi-°C, range [−40,85]. Vector `6c0d` → 34.36 °C.
  - `0x5d` hrv: pairs `(hr u8, rmssd u8)` per 5 min. `[60,40,62,45,58,50]` → hr `[60,62,58]`.
  - `0x6f` spo2: header byte + 1 %/sample, trailing `0xff` sentinel dropped.
  - `0x8b` spo2 R/PI: header + 3-byte `(R u16 BE /16384, PI u8/255×0.05)`.
  - `0x60` ibi+amplitude: 14-byte packed (port the bit layout exactly).
  - `0x61` debug_data: printable→ascii; else subtype `0x24` → `battery_pct=body[1]`,
    `voltage_mv=le16(body,2)` (vector → 95 %, 4200 mV).
  - `0x42` time_sync: u32 LE unix. `0x45/0x53` state text. `0x4b/0x4e/0x5a` sleep phases (2-bit).
- Tests in `lib/__tests__/oura-ble-decode.test.ts` — one per decoder, asserting against the exact
  captured hex from the Rust tests.

## Task B — migration `114_oura_raw_samples.sql`

```sql
CREATE TABLE IF NOT EXISTS oura_raw_samples (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ring_timestamp_ds BIGINT NOT NULL,          -- ring clock, deciseconds
  tag               SMALLINT NOT NULL,
  event_name        TEXT NOT NULL,
  body_hex          TEXT NOT NULL,            -- raw, re-decodable
  decoded           JSONB,                    -- best-effort decode
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, ring_timestamp_ds, tag, body_hex)   -- dedup on re-drain
);
CREATE INDEX IF NOT EXISTS oura_raw_samples_user_tag_ts
  ON oura_raw_samples (user_id, tag, ring_timestamp_ds);
```
Register in `schema.ts`. A row = one raw ring event (its `decoded` may hold multiple samples).

## Task C — ingest + summary API routes

- `POST /api/oura-ble/samples` — auth'd + **admin-gated** (spike), Zod
  `{ frames: { hex: string }[] }` (cap length, rate-limited like sibling ingest routes). For each
  frame: `parseFrame` → if `tag>=0x41`, `parseHistoryEvent` → collect row. Bulk insert
  `ON CONFLICT DO NOTHING`. Return `{ received, stored, byTag }`.
- `GET /api/oura-ble/samples/summary` — counts by `event_name`, total stored, latest HR bpm,
  latest temp °C, latest battery %, newest `recorded_at`. Feeds the tester UI. SWR headers.

## Task D — wire JS forwarding

In the tester screen: buffer `ouraFrame` events with `tag >= 0x41` (history events only — command
responses and `0x33` accel are excluded by the `<0x41` cutoff), and POST them in batches (e.g.
every ~2 s or every N frames) to `/api/oura-ble/samples`. Show the returned/summary counts. The
"Sync" action = `drainHistory()` then let the forwarded frames flow.

## Task E — redo `/admin/oura-ble` as a solid minimal tester UI

- **Prominent connection status**: coloured pill (Connected / Connecting / Scanning / Disconnected)
  + battery, connect/drop counts, uptime. Fix the drop/uptime accounting quirk (count a drop on any
  `ready→not-ready` transition; accumulate connected time on every disconnect).
- **One primary action**: **Sync now** (ensure service running → `drainHistory` → forward frames).
- **Recorded-data readout** (from the summary endpoint): "Stored N events · HR: latest X bpm (N
  samples) · Temp: X °C · Battery X%", refreshed after a sync.
- **Advanced (collapsed by default)**: the raw command buttons (Battery/Info/SyncTime/Accel/Live
  HR/Drain) + the frame-tag counts + the log console — kept for debugging, out of the way.
- Keep theme tokens, Lucide icons, `pt-safe`, real `<Button>`s, file under ~800 lines (split if
  needed).

## Gate + bookkeeping

`pnpm lint && tsc && test && build`; migration applies idempotently; verify the ingest route
end-to-end against local Postgres with real captured frame hex (decode → row → summary). Version
bump + changelog + journal + module-map row. Native side unchanged this increment (no APK rebuild
needed for the JS/DB half; the tester UI ships via Railway).
