# Oura Direct-BLE — Phase 0 Results & Next-Build Checklist

> **Status:** Phase 0 (laptop/desktop CLI hardware spike) **PASSED** — 2026-07-07.
> Companion to `2026-07-06-oura-direct-ble-feasibility.md` (approach) and
> `2026-07-06-oura-direct-ble-phase-0-runbook.md` (the runbook we executed).
> This doc records **what was proven on the actual Ring 5**, **every deviation found
> from the stock `open_oura` information** (code bugs, doc drift, and confirmed facts),
> the **decoded data structures** (the concrete port target), and a **checklist for the
> next build** (the Capacitor plugin + on-phone persistence spike).

**Hardware under test:** Samsung S25 Ultra (target runtime), **Oura Ring 5**, firmware
**2.1.3** / API 2.1.0 / BT stack 9.3.41 / hardware `COR_08` / serial `5038082619832952`.
Spike host: **Windows desktop (WinRT/btleplug)**, with a partial cross-check on **Kali
(VMware + CSR8510 USB dongle, BlueZ)**. Tool: `Th0rgal/open_oura` (Rust CLI), with local
patches (below).

---

## 1. Executive summary

Phase 0 exists to fail cheaply if the ring won't cooperate. **It didn't fail.** Every
existential unknown resolved green:

- ✅ **We can own the ring (Option A).** Official-app factory reset → our own
  `SetAuthKey` accepted → full AES/ECB nonce handshake → `Authenticated: Success` →
  auth-gated battery read. This was the **single biggest blocker** (open_oura issue #6
  had no clear answer); it is now empirically closed on our firmware.
- ✅ **History sync works and is incremental.** First drain: 7604 events. A later drain
  resumed from the **persisted deciseconds cursor** (`1606551`, not `0`) and pulled only
  the 294-event delta — the "backfill without re-download, never gappy" model holds.
- ✅ **The raw data decodes into physiologically-correct values** at **~100% coverage**
  (7597/7604; only benign `ring_start` undecoded). Values cross-check against reality:
  skin temp ~34–35 °C when worn vs ~26–29 °C when handled; MET 1.2 sitting / 4.8–6.1
  moving; HRV rMSSD 32–52 ms; wear/charger transitions detected.
- ✅ **Live sensor streaming works** — `accel` held a continuous 15 s stream, 740 samples
  (~49 Hz), magnitude tracking real hand motion.
- ✅ **Offline re-decode works** (`redecode` re-ran decoders over stored raw with no
  ring) — the maintenance path for future firmware/protocol drift.

**What Phase 0 could NOT answer** (by design — needs either overnight wear or Android
code, neither cheap-to-fake on a desktop CLI): sleep-staging & SpO₂ decode (no real night
yet), multi-day battery, and — the crux for the go/no-go — **day-to-day reconnection UX on
a persistent phone connection.** The CLI's one-shot-per-command model structurally cannot
simulate the Android foreground-service architecture, so that risk is now a *build*
question, not a *spike* question.

**Bottom line:** the foundation is proven; remaining risk is normal engineering risk, not
existential. The next gate is a minimal on-phone auth+persistence spike (Phase 2), which is
the only way to measure the reconnection UX.

---

## 2. Connection-stability verdict (the walk-away criterion)

The stated bar was: *no connection stability → no interest.* "Stability" turned out to be
**two different things**, and they landed differently:

- **Connection *establishment* is finicky — and always will be.** The ring sleeps
  aggressively to hit its multi-day battery target and only advertises when physically
  woken (worn + moving). This is inherent Oura firmware power management — the **official
  app fights the same thing**. The CLI made it feel far worse because every command is a
  cold one-shot with a ~25 s scan window; that is *not* representative of production.
- **Connection *stability once established* is good.** **Zero mid-operation drops** were
  observed all day: the 15 s accel stream held; both syncs (7604 and 294 events)
  completed. The single "wedge" occurred **only** after ~5 rapid cold reconnect/auth/
  disconnect cycles in ~2 minutes (self-inflicted), and it self-recovered via the ring's
  firmware watchdog after real elapsed time.

**Verdict:** for the periodic-sync use cases (own scores, morning freshness, activity) the
connection is **adequately stable *given the right architecture*** (patient scan loop +
one persistent held connection + opportunistic scheduling). The feared failure mode —
connections randomly dropping and corrupting data — was **not** observed. The honest
caveat: a clean multi-day soak test was **not** done and **cannot** be done from the CLI;
the real reconnection UX is only measurable on the Android service. That is exactly what
the next build must test first.

---

## 3. Deviations from the stock `open_oura` information

Everything below differs from — or was previously unverified in — the stock `open_oura`
repo/docs and our `oura-native-ble` skill as written before today.

### 3.1 Code bugs found & patched (all Windows/WinRT-specific except the last)

| # | File | Bug | Fix | Upstream-PR-worthy? |
|---|---|---|---|---|
| D1 | `crates/oura-link/src/ble.rs` (`scan()`) | On WinRT, passing a non-empty `ScanFilter{ services:[OURA_SERVICE] }` to `start_scan` **suppresses the ring at the OS watcher level** — it never reaches `adapter.peripherals()`. Proven by an A/B: unfiltered scan saw the ring, filtered scan didn't, same instant. | Use `ScanFilter::default()` at the OS layer; keep the in-code `services`+`name` guards (which work — `props.services` is populated once the OS filter is empty). | **Yes** |
| D2 | `crates/oura-link/src/ble.rs` (`connect()`) | **Same** bug at the second call site — this is the load-bearing one: **all** connect-based commands (`info`, `pair`, `sync`, `live-hr`) hit it. Error looked like `no matching Oura ring found` even while the ring was provably advertising. | Same `ScanFilter::default()` fix. | **Yes** |
| D3 | `crates/oura-cli/src/main.rs` (`generate_key()`) + `crates/oura-cli/Cargo.toml` | `generate_key()` reads `/dev/urandom`, which **doesn't exist on Windows** → `pair` crashes *after* the irreversible factory reset (worst moment). | Add `getrandom = "0.2"` as a **direct** dep (transitive-in-lockfile isn't enough to `use` it) and replace with `getrandom::getrandom(&mut key)`. **Note:** getrandom 0.2's `Error` does **not** impl `std::error::Error`, so anyhow `.context()` won't compile — use `.map_err(\|e\| anyhow!("...: {e}"))`. (0.3 differs on both the fn name `fill` and error handling.) | **Yes** |

**Patch discipline reminder:** each function brings `feature_mode` into scope with its own
local `use oura_protocol::protocol::feature_mode;` — there is **no** file-level import, so
any edit that references those constants must add the local `use` too.

### 3.2 The `live-hr` "no beats" finding — recorded accurately (not a confirmed bug)

- `cmd_live_hr` (`crates/oura-cli/src/main.rs`) does **not** itself call `set_feature_mode`
  — but the library method `OuraClient::live_heart_rate` (`crates/oura-link/src/client.rs`)
  **already** sends `req_set_feature_mode(DAYTIME_HR, CONNECTED_LIVE)` as its first action
  on every call (and restores `AUTOMATIC` on exit). So **the mode was never the problem**
  (an earlier hypothesis that it was, was wrong — corrected here).
- Setting the mode from a *separate* `feature-mode` invocation is pointless: it reverts to
  `AUTOMATIC` on disconnect (confirmed via `feature-status`), because `connected_live` is
  connection-scoped.
- **`live-hr` captured 0 beats in every attempt today.** Root cause **unconfirmed.** Most
  likely candidates, none ruled out: PPG acquisition needs a longer warm-up / better
  skin-optical lock; **SyncTime was never sent** (may gate live measurement); or the ring
  needs to have been in continuous measurement first. **Not pursued further** — live HR is
  the one goal already assigned to a separate chest-strap track (§6). Left as an open
  question for the on-phone spike.

### 3.3 CLI/doc drift found

- **`feature-mode --help` feature list is stale.** Help shows
  `real_steps | exercise_hr | resting_hr | cva_ppg | ambient`, but the source match arm
  **also** accepts `daytime_hr` (id `0x02`) and `spo2` (id `0x04`). Using the raw id
  (`0x02`) works regardless.
- **`events` / `redecode` have no detail flag** — they only print/recompute counts. Actual
  decoded values live in the SQLite `events.decoded_json` column (query directly).
- **`rdata` is the gated raw-PPG research sampler** (`state|stop|clear|probe`), **not** a
  data dump — do not run it for a normal pull (matches the stock warning).

### 3.4 Ring behaviour confirmed / newly characterised (not in stock docs)

- **RE1 — Reset-and-rekey works (the crux).** open_oura issue #6 is **answered**: factory
  reset via the **official app** (no protocol `1a00` opcode needed), then `pair` installs
  our key. **Confirmed end-to-end.** *(This corrects the stock skill §13, which said "issue
  #6 closed with no answer".)*
- **RE2 — Resolvable Private Address (RPA) rotation.** The ring rotates its BLE address
  every **~1–2 minutes** (we observed **6** different addresses in one session; first byte
  `0x6E`/`0x7E`/… top-bits `01` = RPA). **`--address` is unusable; always match by
  `--name`.** *(Stock notes only mention macOS UUID instability, not the rotation cadence.)*
- **RE3 — Factory-state device name = bare serial.** An un-onboarded ring advertises
  `Oura <serial>` (e.g. `Oura 5038082619832952`); after our re-key it advertises the
  friendly `Oura Ring 5` again. Useful as a reset-success signal.
- **RE4 — Aggressive sleep; wake-on-motion is the reliable trigger.** The radio only
  advertises when physically woken — **worn + continuously moving** near the adapter. A
  long single scan window (`--scan-timeout 90`) + sustained motion is the CLI's best
  approximation of a patient scan.
- **RE5 — The charger does NOT reset the ring.** The ring runs on its own internal battery
  with no power button; unplug/replug of the charger only interrupts charging. The only
  real resets are the app factory-reset (needs BLE) or full battery drain. *(Corrects a
  wrong assumption made mid-spike.)*
- **RE6 — The BLE radio can *wedge*** after rapid connect/auth/disconnect bursts:
  simultaneously **not advertising and not connectable** (`Not connected` on a known/bonded
  device). It recovered **only** after real elapsed time (firmware watchdog), not from any
  action we took. **Retries don't help a wedged radio** (no good moments to catch).
- **RE7 — Single OS-bond slot (suspected).** With Windows holding the bond, a second host
  (Kali) got `org.bluez.Error.AuthenticationCanceled` + `Reason.Remote` (the **ring**
  dropped it). Consistent with the ring accepting one bonded central at a time. Production
  (one app, Option A) is unaffected; but **two hosts can't test concurrently**.
- **RE8 — WinRT needs an explicit OS pairing before encrypted GATT ops.** Subscribing to
  notify characteristics (CCCD write) returned `HRESULT(0x80650005)` "insufficient
  authentication" until the dongle/ring were paired via **Windows Settings → Add device**
  (a silent "Just Works" bond). BlueZ/CoreBluetooth auto-elevate; WinRT does not.
  **Android relevance:** `BluetoothGatt` typically **auto-triggers** the system pairing
  dialog on `INSUFFICIENT_AUTHENTICATION` (closer to BlueZ) — **to be verified** in the
  Phase-2 spike, not assumed.
- **RE9 — Deciseconds cursor confirmed.** `ring_timestamp` / the sync cursor are in
  **deciseconds (100 ms units)**: span `1396593 → 1606550` = 209 957 ds = **5.83 h**,
  matching "~6 h since this afternoon's reset". Confirms the stock cursor-unit claim on our
  firmware.
- **RE10 — SyncTime was never sent in our path** (`reset → pair → features → sync`), so
  `ring_timestamp` is the ring's **internal clock**, *not* wall-clock. `captured_unix` (host
  sync time) gives only coarse anchoring. **Build implication:** send SyncTime before sync,
  and anchor samples to real time carefully (this app's timezone rules make this
  load-bearing).
- **RE11 — ~100% decode coverage on FW 2.1.3.** 7597/7604; only 7 `ring_start` events
  undecoded (benign, `decoded_json = NULL` by design). The Rust `decode_body` decoders
  cover our firmware essentially completely — the port target is concrete and whole.
- **RE12 — Cross-host confirmation.** On Kali/BlueZ, the failures were a **soft rfkill
  block** (`rfkill unblock`) and blueman contention — *different* friction than Windows,
  reinforcing that the flakiness is host-stack-specific, not ring/protocol. Discovery of
  the ring worked identically once the block was cleared (`-77 dBm  Oura Ring 5`).

---

## 4. Decoded data structures (the concrete port target)

`open_oura`'s local SQLite (`oura.db`) after our sync. **Schemas:**

- **`events`**: `id, serial, tag (int), name (text), ring_timestamp (int, deciseconds),
  body (BLOB, raw), decoded_json (TEXT), captured_unix (int, host sync time)`
- **`readings`**: `id, serial, kind, value (REAL), unit, captured_unix` — **only** written
  by the live-streaming path (`insert_reading`); empty after a history sync.
- Plus `device`, `sync_state`, `sqlite_sequence`.

**Event-type distribution (one ~6 h handling-heavy session, 7604 events):** `debug_data`
3071, `debug_event` 1864 (≈65% is firmware/connection chatter — likely **not** stored in
production), `green_ibi_quality_event` 922, `motion_event` 560, `temp_event` 329,
`ibi_and_amplitude_event` 244, `state_change` 214, `feature_session` 117, `ble_connection`
63, `self_test_data_event` 54, `sleep_acm_period` 41, `activity_information` 32,
`wear_event` 23, `motion_period` 19, `scan_start`/`scan_end` 15 each, `sleep_temp_event` 7,
`ring_start` 7, `temp_period` 5, `hrv_event` 1, `alert_event` 1.

**Decoded JSON shapes (verified real values):**

| Event | `decoded_json` shape | Sample |
|---|---|---|
| `ibi_and_amplitude_event` | `{amplitude:[…], hr_bpm:[…], ibi_ms:[…]}` | `hr_bpm:[61,60,62,72,91,150]`, `ibi_ms:[980,996,955,822,658,400]` |
| `green_ibi_quality_event` | `{hr_bpm:[…], ibi_ms:[…], quality:[…]}` | `hr_bpm:[78,76,74,74]`, `quality:[2,2,2,1,1,1,1]` |
| `hrv_event` | `{hr_bpm:[…], interval_min:5, rmssd_ms:[…]}` | `rmssd_ms:[32,43,48,52]` |
| `temp_event` / `temp_period` / `sleep_temp_event` | `{temps_c:[…]}` | worn `[34.79,34.95,35.19,…]`; handled `[26.05,26.09]` |
| `motion_event` | `{avg_x,avg_y,avg_z, low_intensity?, high_intensity?, motion_seconds, orientation}` | `{avg_x:-160,avg_y:-904,avg_z:-600, high_intensity:22, motion_seconds:21}` |
| `activity_information` | `{met:[…], state}` | `{met:[4.8,6.1], state:127}` (moving); `{met:[1.2], state:0}` (sitting) |
| `sleep_acm_period` | `{acm_mad:[…]}` | `{acm_mad:[2.1922,7.2353,…]}` (raw sleep-staging input) |
| `wear_event` | `{state, text}` | `{state:8, text:"chg. detected"}` |

**Volume:** ~1304 events/h ≈ **~31k/day extrapolated**, but **inflated** by today's
reconnect-driven debug chatter (≈65%). Treat as a loose upper bound. A retention/
downsampling policy is still mandatory (per feasibility §4); production likely discards the
`debug_*` classes.

**Live accel stream shape** (`accel`): `x/y/z` int + `|a|` magnitude, ~49 Hz.

**Decoder-refinement note — state enums are raw pass-throughs (not in open_oura source).**
Confirmed by reading `oura-protocol::events::decode_body`: `wear_event.state`,
`activity_information.state`, and `motion_event.orientation` (`body[0] >> 5`, 3-bit 0–7) are
emitted as **raw integers with no named mapping**. `wear_event` carries partial semantics in
its `text` field (`state:8` = "chg. detected"). These are **Phase-3 refinements** — port the
decoders storing the raw ints, then label from controlled captures. Seed hypotheses:
`wear_event.state` 8 = on-charger, 3 = worn/on-finger; `activity_information.state` 127
(=`0x7F`) is likely a **bitfield/sentinel**, not an ordinal (decode bit-by-bit), 0 = clear;
`orientation` = which gravity axis is down (derive by holding the ring in known static
orientations ~30 s each and diffing the synced values).

**Data still un-decoded today (no data existed, not a decode gap):** SpO₂ (0 events in 6 h
— Oura measures it mainly during sleep), and real sleep staging (only raw `acm_mad`/
`sleep_temp` inputs, no actual night). **Both close by wearing the ring overnight and
re-syncing** — near-zero cost, code-free.

---

## 5. Next-build checklist

Target shape (user intent): **a Capacitor plugin that runs *alongside* the production app**,
lands raw ring data locally for us to sort/organise/analyse, and — if it underperforms — can
be **deprecated with a clean fallback to the existing Oura Cloud sync**. The immediate next
step is **on-phone auth + connection persistence**, since that's the one unanswered risk.

### Phase 2 — Minimal on-phone auth + persistence spike (the real go/no-go)
- [ ] Scaffold a Capacitor plugin (see `capacitor-native-plugins` skill) — Android only.
- [ ] Port the **auth handshake** to Kotlin: scan (broad, filter in-code — **carry D1/D2's
      "no OS service-UUID filter" lesson**), connect, GATT service discovery, nonce →
      `AES/ECB/PKCS5` → authenticate, using the **existing installed key**.
- [ ] Verify Android's bonding behaviour (**RE8**): does `BluetoothGatt` auto-trigger the
      pairing dialog on `INSUFFICIENT_AUTHENTICATION`, or do we need explicit
      `createBond()`? Record the answer.
- [ ] Read **one** live value (battery or an `info`-equivalent) to prove connect+auth end
      to end on the S25.
- [ ] **Persistence test (the crux):** hold a connection open in a **foreground service**;
      measure reconnection UX over a realistic window — patient scan loop tolerant of the
      ring's wake-on-motion sleep (**RE4**), watchdog/recovery for a *wedged* radio (**RE6**,
      retries alone don't help), single-bond-slot awareness (**RE7**). Log:
      time-to-first-connect, drop rate, recovery behaviour.
- [ ] **Decision:** does day-to-day reconnection feel acceptable worn normally? This is the
      answer the CLI could not give.

### Phase 3 — Event-decoder port
- [ ] Port `oura-protocol::events::decode_body` (Rust) to Kotlin — the bulk of the work.
      Prioritise the biometric types in §4; the `debug_*`/`state_*` classes can be
      dropped/summarised.
- [ ] **Validate byte-for-byte against today's `oura.db`** (`events.body` → expected
      `decoded_json`) — we have a ground-truth corpus of 7604 events to test against.
- [ ] Keep decoders **pure & infallible (return Option)** and preserve an **offline
      re-decode** path (**RE11 / redecode**), so future firmware drift is a decoder patch,
      not a re-sync.
- [ ] Send **SyncTime** before sync and anchor samples to wall-clock (**RE10**); give the
      time mapping a boundary test (this app's `todayInTz`/timezone rules apply).

### Phase 4 — Offline-first ingestion domain (`oura_raw_samples`)
- [ ] New local SQLite table(s) holding enough to render/analyse offline; new outbox domain
      per the CLAUDE.md offline-sync checklist (local table = server payload =
      `getSyncDelta` = `pullDelta` = `applyDelta`, `sync_status` gating).
- [ ] **Retention/downsampling policy from day one** (reuse the `retention-throttle.ts`
      pattern; do not store `debug_*`). Volume ≈ tens of thousands of events/day.
- [ ] Persist the **deciseconds cursor** (**RE9**) for incremental resume; loop the cursor
      until exhausted.
- [ ] Postgres mirror + `Cache-Control` SWR headers on any new aggregate GET route.

### Phase 5 — Our own analysis (`lib/health/*`)
- [ ] HRV (rMSSD from IBI), resting HR, temp deviation (nightly median − personal baseline),
      **read** sleep staging from the ring's own nibbles (no model). One-formula-one-place.
- [ ] Blend ring biometrics with our training load (ACWR/RPE) for a readiness score the
      Cloud API structurally can't produce.
- [ ] SpO₂ polynomial — **derive Ring-5 coefficients** (stock coeffs are for older gens).

### Cross-cutting — coexistence & fallback (the user's architecture)
- [ ] Keep the **existing Oura Cloud sync path intact and switchable** — the BLE source is
      additive; a feature flag deprecates it and falls back to Cloud with no data-model
      rupture (provenance/`source` column so BLE vs Cloud rows are distinguishable and a
      precedence-ranked merge replaces today's last-writer-wins COALESCE — this is the
      "Native BLE Oura ingestion prep" backlog item, useful regardless of the spike).
- [ ] **One-way-door note:** the ring is currently on **our** key and **off** the Oura
      ecosystem — no Cloud scores flow until we either build the analysis or re-onboard.
      Don't sit in the no-data limbo by default (see §7).

### Separate, immediate track — live exercise HR
- [ ] Buy a standard **BLE chest strap** (HR Service `0x180D`) and wire it via a Capacitor
      BLE plugin. Solves **goal 3** (live HR during lifting rest periods) **this week**,
      independent of the entire Oura project — finger-PPG is motion-noisy and this track
      never depended on the direct-BLE work.

---

## 6. Goal scorecard (updated with today's evidence)

| Goal | Verdict | Note |
|---|---|---|
| 1. Stop paying Oura sub | ✅ achievable, **last** | Can't cancel until goal 2 is built **and** trusted via overnight validation |
| 2. Own readiness/sleep/activity scores | ✅ **strongly supported** | Raw inputs (HRV, temp, MET, IBI, motion) all decode into correct values |
| 3. Live HR during lifting | ⚠️ **decouple** | 0 beats today; use a chest strap regardless |
| 4. No morning Oura-app ritual | ✅ achievable | Once reliable sync is built |
| 5. Ring activity tracking (save phone battery) | ✅ supported | MET data decodes correctly; modest battery upside |

---

## 7. Immediate practical decision (independent of the build)

The ring is **on our key, feeding nothing usable** right now (off Oura, and we've built
nothing). Two sane options:
- **Committing to build:** wear it **tonight** → gives the overnight **sleep + SpO₂** data
  that's the last untested decode path, at near-zero cost, and is real dogfooding.
- **Want to deliberate:** **re-onboard to the official Oura app** (factory-reset again,
  re-add) to restore normal scores while deciding — reversibility is proven. Don't default
  into weeks of no-data limbo.

---

## 8. Artifacts & follow-ups

- **Ground-truth decode corpus:** the desktop `oura.db` (7604 events) — keep it; it's the
  Phase-3 validation fixture.
- **Local key:** `key.hex` (16 bytes / 32 hex) — a real credential; keep it out of git and
  off shared machines (open_oura's `save_key` chmod is `#[cfg(unix)]`, so no owner-only
  perms on Windows — cosmetic, noted).
- **Upstream PR to `Th0rgal/open_oura`:** bundle D1/D2 (WinRT scan filter), D3 (`getrandom`
  Windows RNG), and the `scan_all` diagnostic example. Not started.
- **Skill/feasibility corrections landed with this doc:** issue-#6 answer (RE1), reset-via-
  app path, RPA rotation (RE2), the deviation list above.
