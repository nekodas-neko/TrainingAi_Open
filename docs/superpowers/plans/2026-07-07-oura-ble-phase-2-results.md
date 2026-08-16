# Oura Direct-BLE Phase 2 — On-Phone Auth + Persistence Spike: RESULTS

**Status: PASSED (core crux)** — 2026-07-07, on the owner's Samsung Galaxy S25 Ultra against the
actual Ring 5 (FW 2.1.3, already re-keyed to our own AES key in Phase 0).

This is the results/findings companion to
[`2026-07-07-oura-ble-phase-2-onphone-spike.md`](2026-07-07-oura-ble-phase-2-onphone-spike.md)
(the plan) and the successor to
[`2026-07-07-oura-direct-ble-phase-0-results.md`](2026-07-07-oura-direct-ble-phase-0-results.md)
(the desktop-CLI Phase 0). It records what the on-device run proved, the bugs found and fixed
live, the operational learnings, and the go/no-go for Phase 3.

---

## 1. Executive summary

The Phase-0 ring protocol runs inside the APK. On the S25 we achieved, end-to-end, from the app:

```
scan hit: name=Oura Ring 5 rssi=-70 mfrMatch=true
connecting to 73:2D:2E:57:55:A6 (bondState=10)
connectionStateChange status=0 newState=2      ← connected
mtu=247 status=0                                ← MTU negotiated
auth: requesting nonce
auth: nonce received, sending encrypted response
auth: SUCCESS                                   ← our own key authenticated
READY in 9882ms (connect #1)
```

Then, over a held connection: **battery decoded (100%)**, **live accelerometer streaming**
(`0x33`, 1000+ frames), **firmware/serial** (`0x09`/`0x19`), and **incremental history drain**
with the deciseconds cursor advancing correctly (`cursor→1396612 … 1396861`, RE9). The
foreground service **held the connection** (`Connected total: 5m of 6m`, 0 drops on the charger)
and **auto-reconnected** after a Bluetooth toggle without the charger and without re-pairing
(`Connects/drops 1/0 → 2/0`, ~11 s to reconnect).

**Every existential unknown that gated the whole direct-BLE track is resolved.** The remaining
questions are quantitative (multi-day reconnection reliability, worn-idle wake latency) and are
answered by wearing the ring, not by more code.

---

## 2. What was proven on-device

| Capability | Result |
|---|---|
| Scan + name/mfr-id match | ✅ Reliable across every test round (rssi −48 to −75) |
| Connect + MTU 247 | ✅ (once the ring is awake — see §4) |
| **App-level AES auth with our own key** | ✅ `auth: SUCCESS` — the crux |
| Battery decode | ✅ 100% / 102% (charging) |
| Firmware / serial read | ✅ `0x09`/`0x19` frames returned |
| Live accelerometer stream | ✅ `0x33` ~50/s while enabled |
| SyncTime / enable-notifications | ✅ `0x13`/`0x1d` responses |
| **Incremental history drain (RE9)** | ✅ cursor persisted + advancing, `events=8` per batch |
| **Persistent held connection** | ✅ 5m of 6m on charger, 0 drops |
| **Automatic reconnect after a drop** | ✅ BT toggle → reconnected on its own, no charger/re-pair |
| Live HR (worn) | ⏳ Not yet tested worn — only meaningful on a finger (see §6) |
| Overnight sleep / SpO₂ decode | ⏳ Deferred — needs a worn night (see §6) |

---

## 3. Bugs found and fixed live (during the on-device session)

Each was found from real device signal (screenshots / `chrome://inspect` console), not inferred:

1. **Debug screen hung forever on "Checking native plugin…" (v1.116.1).** `getOuraBle()` returned
   Capacitor's `registerPlugin()` Proxy directly from an `async` function; the Proxy's `get` trap
   answers *any* access (incl. `then`) with a callable, so JS treated it as a thenable and called
   `plugin.then(...)` as a native method → the bridge rejected it as unimplemented → unhandled
   rejection → the promise never settled. Fixed by returning `{ plugin }` (matching
   `gps-tracking.ts`). Diagnosed from the real `chrome://inspect` console
   (`"OuraBle.then() is not implemented on android"`).

2. **Duplicate-start connect race → GATT status 133 (v1.116.2).** `OuraRingService.onStartCommand`
   had no guard against a second start spawning a competing `OuraGattClient` while one was already
   connecting. Guarded (`client != null` no-ops); JS Start button also disables while in flight.
   Added a `stopScan()`→`connectGatt()` settle delay (status-147 mitigation) and switched the
   native log to local wall-clock time.

3. **Backoff off-by-one (v1.116.3).** `scheduleRetry()` indexed `BACKOFF_MS` by
   `consecutiveFailures` *after* it was incremented for the current failure → first retry fired at
   10 s instead of 5 s. Confirmed against the on-device log.

4. **`autoConnect=true` is WORSE on this device (tried v1.116.3, reverted v1.116.4).** Switching
   `connectGatt()` to `autoConnect=true` produced an **instant, deterministic status-135 failure**
   on every attempt, including after a full phone reboot. Since `autoConnect=true` is supposed to
   fail slowly/silently, this is evidence Samsung's stack doesn't honour it as stock Android does.
   Reverted to a direct connect (`autoConnect=false`) + same-device retry.

---

## 4. The single biggest operational learning: the ring must be AWAKE to connect

**Every early connection failure was the ring's radio being asleep, not our code or the Samsung
stack.** Confirmed decisively: nRF Connect (the gold-standard BLE app) *also* failed to connect
from the same phone while the ring was worn-idle — but **succeeded the moment the ring went on the
charger**, discovering the ring service `98ed0001-a541-11e4-b6a0-0002a5d5c51b`. Our app then
connected + authenticated on the charger on the first try.

- **Worn + idle** → radio sleeps hard → connect attempts fail (generic 133/135/147). This is not
  fixable in app code.
- **Worn + moving** (RE4) → radio wakes → connectable.
- **On charger** → always connectable (the reliable path, matches Phase-0's own note).

**Implication for UX:** the charger is the reliable way to establish the *first* connection (as in
the official Oura app's setup). After that, the service auto-reconnects whenever the ring is awake.
The charger is also a guaranteed "force a catch-up sync" escape hatch any time.

---

## 5. RE8 answered: Android requires a native bond

**New finding vs Phase 0** (desktop/btleplug used app-level auth only, no OS bond): on
Android/Samsung, connecting triggered a **native Bluetooth pairing dialog** ("Pair with Oura Ring
5?"). The owner tapped Pair. Notes:

- App-level `auth: SUCCESS` occurred at `bondState=10` (BOND_NONE) — i.e. our AES auth does **not**
  require the OS bond; the bond is an additional Android-side security handshake for the secured
  characteristics.
- Bonding is likely **beneficial** for a rotating-address device: it lets Android resolve the
  ring's RPA to a stable identity via the bond's IRK, which should make reconnection faster/more
  reliable. Left in place; the soak will confirm it helps rather than hurts.
- Our `OuraGattClient` already has the RE8 `createBond()`-on-insufficient-auth path; the observed
  dialog is consistent with the secured-characteristic subscription triggering Android's bond flow.

---

## 6. Still open (deferred, not blockers)

1. **Multi-day persistence/reconnection soak** — the true go/no-go for daily use. Wear it 2–3 days;
   watch `Connects/drops`, reconnect latency worn-idle, and whether Samsung's battery optimiser
   keeps the foreground service alive. If reconnection worn-idle is poor, add
   **CompanionDeviceManager** association + a battery-optimisation exemption (the official app's
   background-reliability mechanism).
2. **Live HR worn** — the RE10 0-beats retest from Phase 0. Only meaningful on a finger (PPG needs
   blood flow); untestable on the charger.
3. **Overnight sleep-staging / SpO₂ decode** — needs a worn night to generate the events.
4. **Metrics accounting quirk** — a Bluetooth-off disconnect doesn't register as a `ready→drop`, so
   `dropCount` and `totalConnectedMs` under-count. Cosmetic; fix in the tester-UI cleanup.

---

## 7. Decision gate → GO for Phase 3

The reconnection-UX question is answered well enough to proceed: **the ring pairs once on the
charger, then the service reconnects on its own**, and — critically — the **history-buffer + cursor
model means dropped connections never lose data** (the ring records 24/7; each reconnect drains
everything since the last cursor). That makes the intermittent-connection reality acceptable by
design.

**Next (Phase 3 + a pragmatic slice of Phase 4):** decode the drained history events into real
values (HR from IBI first, then temperature, HRV, SpO₂) and land them in Postgres via a server-side
ingest path (the same architecture as the existing Oura Cloud sync / Health Connect ingest —
**not** a new offline-first outbox domain). Plan:
[`2026-07-07-oura-ble-phase-3-4-mvp.md`](2026-07-07-oura-ble-phase-3-4-mvp.md).

The full offline-first `oura_raw_samples` local-store/outbox mirror, our own `lib/health/*` scores
(Phase 5), CompanionDeviceManager, and live-HR-worn validation remain later, separately-planned
work.
