# Scale BLE connect latency — "priming" investigation

**Status (2026-08-01): open, parked for a future session with a stronger model.** This is a
reference doc, not a runbook — it exists so the next session doesn't re-derive what's already
known before picking the thread back up. No code changes came out of this pass; only the
diagnostic instrumentation from #977 already on `main`.

## The owner's report

After confirming #976's retrying-toast fix, the owner raised a separate, longer-standing
observation: connect/detect speed feels **worse than the very first integration (#848)**, and
they've been informally "priming" the connection by stepping on once, walking away, then getting
an effectively-instant connect on a second attempt ~30s later.

## What's already true on `main` — read this before assuming there's a gap

1. **The connection is already held open indefinitely once linked** (#972, "make the scale BLE
   connection persistent, like the Polar strap") — it does **not** close after a single reading.
   `ScaleBleService`/`ScaleGattClient`'s class doc comments (`android/app/src/main/java/com/
   trainingai/app/scale/{ScaleGattClient,ScaleBleService}.kt`) document the same conclusion this
   doc is about: on-device testing kept finding "instant" success only when a connection had
   *already* been established by something (nRF Connect, the official app, or this app) and never
   torn down — i.e. every "primed" success was really "still connected from last time," not a
   missing handshake or protocol trick.
2. **A peer-initiated drop is invisible to the user and auto-recovers.** The scale disconnects
   itself a few seconds after a stable reading (`status=19`, `GATT_CONN_TERMINATE_PEER_USER` —
   its own post-reading power-save, not our code). `ScaleBleService` reconnects in the background
   without reopening the "weighing you…" toast or a false failure notification
   (`hasCapturedThisWake` guard, extended to the `retrying` broadcast in #977 after a
   `chrome://inspect` capture on 2026-08-01 caught it leaking through one call site #974 hadn't
   covered).
3. **Stage-timing diagnostics are live** (#977) — every stage of `ScaleGattClient`'s connect
   sequence logs elapsed ms since `connectGatt()`: `gatt connected`, `services discovered`,
   `notify subscribed`, `measurement requested`, `first FFE1 notification`.

## The hardware constraint that bounds all of this

**The scale does not advertise BLE at all while idle.** Owner-measured (2026-07-31): it stays
connectable for roughly ~19s after being physically stepped on, then goes fully dark. This is a
firmware/power-management property of the scale itself, not something either our app or Renpho's
official app can work around — you cannot open a GATT connection to a device that isn't
advertising. So "keep it primed whenever it's in range and the home screen is up" **cannot mean
"pre-connect before a step-on"** — there is nothing to connect to yet. The only thing "primed" can
mean, for us or for Renpho, is "the link from the *last* interaction hasn't been torn down yet,"
which is exactly what #972 already built.

## On-device timing data (2026-08-01, `chrome://inspect` capture)

Captured on a real weigh-in session, home screen (`/health/sleep`... actually the Home tab),
against the #977 diagnostics. Two connects in the same session:

| Stage | 1st connect (cold, scan-hit → connect) | 2nd connect (auto-reconnect after peer drop) |
|---|---|---|
| `connecting` → `gatt connected` | **+1613ms** | **+666ms** |
| `gatt connected` → `services discovered` | +553ms | +559ms |
| `services discovered` → `notify subscribed` | +18ms | +20ms |
| `notify subscribed` → `measurement requested` | +15ms | +15ms |
| → `first FFE1 notification` (link proven alive) | +7ms | +10ms |
| **Total to link-alive** | **2206ms** | **1270ms** |

**Reading:** the entire ~950ms gap between the two lives in exactly one stage — raw GATT
connection establishment (`connecting` → `gatt connected`). Service discovery, notify-subscribe,
and the measurement request are consistently fast and near-identical both times (~590ms
combined, both runs). Nothing in *our* discover/subscribe/request sequence explains the
difference — it's the Android BLE stack's own connection-establishment time, most plausibly some
form of address-resolution/session caching for a device the stack *just* handled.

**Important caveat — this is not yet the sample that matters most.** The "2nd connect" above was
an **automatic reconnect moments after a peer-initiated drop, same session** — not the owner's
originally-reported scenario of walking away and returning ~30s later for a fresh manual attempt.
It's suggestive (same direction of effect: warm beats cold), but it is not proof the 30s-later
case behaves the same way. **Next capture needed:** a genuine cold app-open weigh-in (no prior
connection this app session) immediately followed by a second **manual** attempt ~30s+ later,
so the two rows above can be compared against a true "walked away and came back" pair instead of
an automatic same-session recovery.

## Renpho APK reverse-engineering — parked, not started

The idea on the table: decompile the official Renpho app's APK to see if it does anything
different in its GATT connection sequence that would explain why it *feels* more consistent.

**Status: blocked on the artifact.** This sandbox has no `adb` bridge to the owner's device and
no general tool for fetching an arbitrary third-party APK — pulling one from an untrusted APK
mirror speculatively isn't something to do without the owner supplying the actual file (e.g.
exported via an APK-extractor app, or `adb pull` on their own machine). If/when the APK is
provided, decompile with the same spirit as the `open_oura`-sourced Oura BLE work (interoperability
research on hardware we own — see `oura-native-ble` skill for the precedent) and diff against
`ScaleGattClient.kt`'s connect sequence.

**Expectation to set before spending time on this:** given the hardware constraint above, it's
unlikely decompiling reveals an "always-primed" trick — Renpho can't pre-connect to a
non-advertising device any more than we can. More plausible things it could reveal:
- **Bonding/encryption.** If Renpho's app bonds (pairs) with the scale rather than using an
  unauthenticated GATT connection, the Android BLE stack caches link keys and may resolve/connect
  faster on subsequent attempts. Worth checking whether we currently bond at all (grep
  `createBond`/`BOND_BONDED` in the scale package — a quick search during this session found none,
  so we likely don't).
- **Connection parameters.** Requested connection interval, PHY (1M vs 2M), or MTU negotiated
  during the connect could shave real time off the observed ~1.6s cold-connect stage.
- **UX, not protocol.** Renpho's app may simply not expose a "still trying" state the way our
  toast does, so the same underlying latency doesn't register to the user as inconsistent. This
  is the cheapest explanation and doesn't require decompiling anything to fix — it's a UI
  question, not a BLE one.

## Next steps for whoever picks this back up

1. Capture the "genuine 30s-later cold reconnect" sample described above and compare its
   `gatt connected` stage time against both rows in the table here.
2. Check whether `ScaleGattClient`/`ScaleBleService` currently bond with the scale at all; if not,
   test whether `BluetoothDevice.createBond()` before `connectGatt()` changes the cold-connect
   time (tradeoff: adds its own one-time UX step and a bonding round trip the first time).
3. If the owner supplies the Renpho APK, decompile and diff its connection sequence against
   `ScaleGattClient.kt` — bonding, connection priority/PHY requests, and write-timing order are the
   things worth comparing first per the expectations above.
4. If none of the above narrows the gap, the honest conclusion is that this is normal Android BLE
   stack variance on a first-ever connection to a given peer, and the fix is a UX one (don't show
   a "still trying" state that reads as broken) rather than a protocol one.

## Pointers

- Code: `android/app/src/main/java/com/trainingai/app/scale/{ScaleGattClient,ScaleBleService,
  ScaleBleScanManager}.kt`
- Arc: PRs #969–#977 (stored-measurement drain, persistent connection, dedup/toast fixes, timing
  diagnostics)
- `projectOverview.md` → `[devices][body] Scale passive-scan background sync` Known-Issues entry
  — the "not yet on-device tested" note this doc's timing table answers
- Plan: `docs/superpowers/plans/2026-07-30-scale-stored-measurement-drain-and-scan-latency.md`
- Precedent for third-party BLE protocol reverse-engineering in this repo: `oura-native-ble` skill
