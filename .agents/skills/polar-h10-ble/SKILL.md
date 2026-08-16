---
name: polar-h10-ble
description: Use when working on the Polar H10 chest-strap integration — connecting the H10 over BLE, parsing the standard Heart Rate Service (HR + RR intervals), the proprietary PMD service (ECG / accelerometer streaming), the chest-strap live-HR source and its precedence over the Oura ring, or the H10's internal exercise recording. Trigger on "Polar H10", "chest strap", "HR strap", "PMD service", "ECG streaming", "RR intervals", or any work on the chest-strap HR source.
version: 1.0.0
---

# Polar H10 — BLE Protocol & Integration Knowledge Base

The owner wears a **Polar H10** chest strap (bought 2026-07-16) as the in-workout heart-rate
source. It is the *default* live-HR source whenever connected; the Oura Ring 5's direct-BLE
source is the fallback (registration-order precedence in `lib/live-hr/manager.ts` — the
`'chest_strap'` source id has been reserved in `lib/live-hr/types.ts` since Plan 1).

**Why the strap wins:** ECG-electrode HR is beat-accurate and motion-robust; the ring's
finger PPG is motion-noisy (captured 0 beats under load in Phase 0) and only reads well
~10 s into a still-handed rest. The strap gives continuous HR through sets *and* rest, plus
per-beat RR intervals (HRV) the ring cannot provide live.

**Unlike the Oura pipeline, nothing here is reverse-engineered from a frozen firmware.**
HR + RR use the *standard* Bluetooth Heart Rate Service — stable, documented, no auth
handshake, no AES key, no history-drain cursor. Only the optional ECG/ACC streams use
Polar's proprietary (but well-documented and openly implemented) PMD service.

Implementation plans:
- Core (strap-wins live HR): `docs/superpowers/plans/2026-07-08-live-hr-plan-3-chest-strap-source.md`
- Polar-specific extension (RR/HRV, battery, contact bit, PMD stretch): `docs/superpowers/plans/2026-07-16-polar-h10-integration.md`

---

## §0 Capability inventory — what the H10 can and cannot do

| Capability | Supported | Transport | Notes |
|---|---|---|---|
| Heart rate (bpm, 1 Hz) | ✅ | Standard HRS `0x180D` | Beat-derived from ECG electrodes |
| RR intervals (beat-to-beat, HRV) | ✅ | Standard HRS `0x180D` | In the same `0x2A37` notification; 1/1024 s units |
| Sensor-contact flag ("strap worn") | ✅ | Standard HRS `0x180D` | Flags bits 1–2 of `0x2A37` |
| Raw ECG | ✅ | **PMD service** (proprietary) | 130 Hz, 14-bit, µV |
| Raw 3-axis accelerometer | ✅ | **PMD service** (proprietary) | 25/50/100/200 Hz; ±2/4/8 G; milli-g |
| Battery level | ✅ | Standard Battery Service `0x180F` | uint8 % |
| Internal exercise recording | ✅ | PS-FTP (SDK-only, see §4) | ONE session, HR-only @1 s, ~30 h max |
| 5 kHz GymLink + ANT+ broadcast | ✅ | Analog / ANT+ (not BLE) | HR only; concurrent with BLE |
| Steps / cadence / activity score | ❌ | — | **No step counter, no cadence, no activity metrics.** Raw ACC only — any cadence would be our own signal processing. Steps stay on the ring pipeline. |
| SpO₂ | ❌ | — | No optical sensor |
| Sleep tracking / PPG / PPI | ❌ | — | Optical-sensor features (Verity Sense/OH1), not H10 |
| Gyroscope / magnetometer / temperature | ❌ | — | Not present / not exposed |

> ⚠️ Marketing pages loosely say the H10 "supports running cadence" — that is Polar *watch*
> ecosystem functionality computed from the strap's raw ACC by the watch, not a BLE
> characteristic the strap exposes. Do not promise steps/cadence from this device.

---

## §1 Integration architecture in this repo

The H10 plugs into the **source-agnostic live-HR layer** (`lib/live-hr/`) — it does NOT
touch the Oura native Kotlin stack (`android/.../oura/`), `oura_raw_samples`, or the
`/api/oura-ble/samples` ingest. The two devices coexist purely through `LiveHrSource`:

| Concern | Where |
|---|---|
| Source interface + `'chest_strap'` id | `lib/live-hr/types.ts` (shipped) |
| Precedence (strap first, ring fallback) | `lib/live-hr/manager.ts` — registration order = precedence; `activeSourceId()` = first non-disconnected source |
| Strap source implementation | `lib/live-hr/chest-strap-source.ts` (planned) over `@capacitor-community/bluetooth-le` |
| `0x2A37` parser (pure, unit-tested) | `lib/live-hr/hr-measurement.ts` (planned) |
| Paired-device persistence | `lib/live-hr/paired-strap.ts` (planned, localStorage — safe because the H10's MAC is stable, §5) |
| Pairing UI | `components/settings/chest-strap-pairing.tsx` (planned) |
| Sample persistence | `POST /api/hr-ingest` → `oura_heartrate` with `source='chest_strap'` (planned) |
| Read precedence | `getHrForWindow` (`lib/data/postgres/slices/oura.ts`) — strap over `ble` per time bucket (planned) |
| UI consumption | `useLiveHr()` + `LiveHrChart` etc. — **source-agnostic, no changes needed** |

BLE transport is the **community Capacitor plugin** (`@capacitor-community/bluetooth-le`),
not hand-written Kotlin: standard GATT needs no foreground service, no auth, no drain state
machine. It self-registers via `npx cap sync android` — no `MainActivity.registerPlugin`
edit — but it IS a native plugin: **owner APK rebuild required**, and nothing BLE runs in
the sandbox (same verification rules as the Oura plugin).

---

## §2 Standard GATT map (no SDK, no PMD needed for HR/HRV)

| Service / Characteristic | UUID | Properties |
|---|---|---|
| Heart Rate Service | `0000180d-0000-1000-8000-00805f9b34fb` | — |
| · HR Measurement | `00002a37-0000-1000-8000-00805f9b34fb` | Notify |
| · Body Sensor Location | `00002a38-…` | Read (H10 → "Chest") |
| Battery Service | `0000180f-…` | — |
| · Battery Level | `00002a19-…` | Read/Notify (uint8 %) |
| Device Information Service | `0000180a-…` | — |
| · Manufacturer / Model / Serial | `0x2A29` / `0x2A24` / `0x2A25` | Read |
| · HW / FW / SW revision | `0x2A27` / `0x2A26` / `0x2A28` | Read |

### `0x2A37` Heart Rate Measurement — value layout

```
[flags:1] [heart_rate:1|2] [energy:2]? [rr:2]* …
```

Flags byte:
- **bit 0** — HR format: `0` = uint8 at byte 1; `1` = uint16 LE at bytes 1–2
- **bit 1** — sensor contact status (1 = electrode contact detected — "strap is worn")
- **bit 2** — sensor contact *supported* (H10 sets this)
- **bit 3** — Energy Expended field present (uint16 LE, skip it)
- **bit 4** — RR intervals present: one or more uint16 LE values fill the rest of the packet

RR conversion: raw is in **1/1024 s units** → `rr_ms = raw * 1000 / 1024`. A single ~1 Hz
notification carries *all* beats since the last packet (multiple RRs at high HR). This is
the HRV source — rMSSD/SDNN over RR windows.

Contact-bit use: when bits 2+1 read "supported but no contact", the strap is on the body of
the *strap* but not the chest (or dry electrodes) — treat as low-quality/not-worn rather
than disconnected.

---

## §3 PMD service — ECG & ACC streaming (proprietary, optional)

Only needed for raw ECG/accelerometer. Corroborated across four independent open
implementations (see §9); **pin a captured on-device test vector before shipping any
decoder** (same rule as the Oura pipeline).

| Role | UUID | Properties |
|---|---|---|
| PMD Service | `FB005C80-02E7-F387-1CAD-8ACD2D8DF0C8` | — |
| PMD Control Point | `FB005C81-02E7-F387-1CAD-8ACD2D8DF0C8` | Read, Write, **Indicate** |
| PMD Data | `FB005C82-02E7-F387-1CAD-8ACD2D8DF0C8` | **Notify** |

Flow: enable **indications** on Control Point + **notifications** on Data, then drive via
Control-Point writes; sample frames arrive on Data.

**Control-point op codes (byte 0):** `0x01` get settings · `0x02` start · `0x03` stop.
**Measurement types (byte 1):** `0x00` ECG ✅ · `0x02` ACC ✅ (`0x01` PPG, `0x03` PPI,
`0x05` gyro, `0x06` mag — not on H10).

**Settings TLV** (in start commands and get-settings responses):
`[type:1][len:1][value:2 LE]…` where type `0x00` = sample rate Hz, `0x01` = resolution
bits, `0x02` = range G, `0x04` = channels. TLV order is not fixed.

Get-settings response: `[0xF0, op, type, error, settings…]` — payload starts at byte 4 on
some firmware, byte 5 on others; parse defensively.

**Start ECG (130 Hz / 14-bit):**
`02 00  00 01 82 00  01 01 0E 00` (rate 0x0082=130; resolution 0x000E=14)

**Start ACC (200 Hz / 16-bit / ±8 G):**
`02 02  00 01 C8 00  01 01 10 00  02 01 08 00`

**Stop:** `03 <type>`.

**Data frame common header:**
```
byte 0    : measurement type (0x00 ECG | 0x02 ACC)
bytes 1-8 : uint64 LE timestamp, NANOSECONDS since 2000-01-01 device epoch,
            stamped at the LAST sample of the frame (back-derive earlier samples
            by subtracting n/sampleRate)
byte 9    : frame type
byte 10+  : samples
```

**ECG frame** (frame type `0x00`): samples are **3-byte signed LE** → µV
(`raw = b0|b1<<8|b2<<16`, sign-extend bit 23). Count = `(len−10)/3`, ~7.69 ms apart.

**ACC frames:** frame type `0x00`/`0x01` = raw `[x,y,z]` each **int16 LE in milli-g**
(count = `(len−10)/6`); frame type `0x02` = **delta-compressed** — 6-byte int16 reference
sample, then a delta header (count + per-axis bit width), then bit-packed signed cumulative
deltas. Which frame type the H10 emits varies with rate/resolution — branch on byte 9,
never assume.

---

## §4 Internal exercise recording (PS-FTP — SDK-only territory)

- On-board memory holds **exactly ONE recording**: HR at 1 s sample time, up to **~30 h**
  (memory ≠ the ~400 h *battery* figure). ECG/ACC are streaming-only, never recorded.
- Exposed via the Polar SDK's H10-specific API (`FEATURE_POLAR_H10_EXERCISE_RECORDING`):
  start/stop/status/list/read/remove. Fetch-and-delete before starting a new one.
- Under the hood it's Polar's **PS-FTP** file protocol over BLE — substantially harder to
  reimplement than PMD. **If we ever want offline recording, wrap the SDK; don't
  reverse-engineer PS-FTP.** (Known drift example: fw 4.10.0 broke offline R-peak fetch
  with error 106 — polar-ble-sdk issue #778.)
- For our use (live HR while the phone is present, ring as the ambient recorder) internal
  recording is a nice-to-have, not queued.

---

## §5 Connection behavior & quirks

- **Advertising name:** `Polar H10 XXXXXXXX` (device id printed on the pod); advertises HRS
  `0x180D`. Filter the OS picker by the HRS UUID.
- **Stable public MAC — the opposite of the Oura ring.** The H10 does not rotate its
  address; caching `deviceId` in localStorage and reconnecting directly is safe. (The Oura
  pipeline must scan by name/manufacturer-id `0x02b2` because of its rotating RPA — do not
  copy that pattern here.)
- **No bonding required** for HRS or PMD streaming. Do **not** create a system-level
  Android bond — Polar advises against pairing in system Bluetooth settings; a system bond
  can interfere with app connections. Connect directly from the app.
- **Two concurrent BLE connections** + 5 kHz + ANT+ simultaneously — the strap can serve
  our app and a watch at once. But only one client can hold a given PMD stream, and a
  backgrounded Polar app (Flow/Beat/Sensor Logger) can occupy a slot (SDK issue #555).
- **Samsung `autoConnect=true` is unreliable** (proven on-device with the Oura ring,
  v1.116.4) — use direct connect + bounded retry here too.
- **Keep the pod snapped into the moistened strap during use** — a detached pod
  browns out mid-transfer (official Known Issues), and dry electrodes = no/garbage
  ECG and flaky contact detection. User-education, not a bug.
- **Firmware updates come via the Polar Flow app** — there is no in-app update path.
  A firmware bump can change PMD behavior (see the 4.10.0 regression) but the *standard*
  HRS path is spec-stable. Record the FW revision (DIS `0x2A26`) at pairing; treat a PMD
  decoder break after an owner-initiated Flow update as a re-validation event, not a bug.

---

## §6 Polar BLE SDK vs direct GATT — decision

**Decision: direct GATT via `@capacitor-community/bluetooth-le`. No Polar SDK.**

| | Direct GATT | Polar BLE SDK |
|---|---|---|
| HR + RR | Trivial (standard `0x2A37`) | Works, but overkill |
| ECG/ACC (PMD) | Proven by 4+ open implementations (§9) | First-party |
| Offline recording | ✗ (PS-FTP too costly to RE) | ✅ the only sane path |
| Platform | Any GATT client (JS plugin OK) | Android Kotlin (RxJava) / iOS Swift only — no JS binding; would need hand-written Kotlin wrapping |
| License | n/a | **Custom "Polar SDK License" — NOT Apache**; legal review before bundling |

The SDK would drag RxJava + a non-OSI license into the APK and force a hand-written Kotlin
plugin for features we get from standard GATT in TypeScript. Revisit only if internal
recording (§4) is ever wanted.

---

## §7 Physical / battery

CR2025 coin cell (user-replaceable; CR2032 does NOT fit), ~400 h use. WR30 (30 m).
BLE range ~10 m realistic. Pod ~65×34×10 mm, ~21 g. Battery Service gives %, so the
pairing UI can surface it — a dying coin cell presents as flaky connections.

---

## §8 Risks & unverified items

1. **ACC frame-type byte** (raw vs delta) per rate/resolution — documented both ways;
   confirm on-device (read byte 9) before trusting a decoder. Pin captured vectors.
2. **Get-settings payload offset** (byte 4 vs 5) varies by firmware — parse defensively.
3. **PMD spec PDF** in the SDK repo's `technical_documentation/` is the authority for
   frame formats; the §3 layouts are cross-corroborated but were not extracted from the
   PDF itself. Before shipping a PMD decoder, read the PDF + `BlePmdClient` source and pin
   test vectors.
4. **`oura_heartrate` conflict semantics**: `upsertOuraHeartrate` is
   `onConflictDoNothing` on `(user_id, timestamp)` — first writer wins on an exact
   timestamp collision with a ring rollup row. Ring rows are 5-min binned so collisions are
   edge-case; read-path bucket precedence (strap over `ble`) is the real merge rule.
5. **Web sandbox verifies nothing BLE** — `@capacitor-community/bluetooth-le` is native;
   only the `0x2A37`/PMD parsers and precedence logic are unit-testable. On-device (S25
   APK, owner rebuild) is the authoritative check, per the Canonical Runtime rules.

---

## §9 References

- Official H10 product/feature doc: <https://github.com/polarofficial/polar-ble-sdk/blob/master/documentation/products/PolarH10.md>
- Polar BLE SDK (README, license, `technical_documentation/` PMD spec PDFs): <https://github.com/polarofficial/polar-ble-sdk>
- PMD field-level protocol docs (best RE writeup): <https://github.com/MesmerPrism/PolarH10/tree/main/docs/protocol>
- Direct-GATT ECG reference: <https://github.com/valhovey/polar-h10-ecg>
- Direct-GATT ECG+ACC reference: <https://github.com/kbre93/dont-hold-your-breath>
- fitnesshrv H10 ECG/ACC writeup: <https://www.fitnesshrv.com/2023/05/08/polarh10.html>
- Recording duration (~30 h HR-only): <https://support.polar.com/en/support/how_long_a_training_session_can_i_record_with_h10>
- Tech specs (CR2025, 400 h, GymLink): <https://support.polar.com/e_manuals/h10-heart-rate-sensor/polar-h10-user-manual-english/technical-specifications.htm>
- fw 4.10.0 offline-recording regression: <https://github.com/polarofficial/polar-ble-sdk/issues/778>
