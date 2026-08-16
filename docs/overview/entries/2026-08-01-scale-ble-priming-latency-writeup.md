# 2026-08-01 — Scale BLE connect-latency investigation writeup (docs only)

Branch: `claude/bluetooth-scale-integration-jcuvs2`

Owner rebuilt the APK after #977 (stored-reading drain restore + connect-stage timing diagnostics)
and captured a real `chrome://inspect` session covering a full weigh-in, including a peer-initiated
disconnect and automatic reconnect. Asked to also read through the Renpho app's APK for anything to
learn about its apparent consistency, and whether the scale can be kept "primed" whenever it's in
range with the home screen open.

## What this session did

No code changes — pure analysis and documentation of the captured log, plus reading the current
`ScaleGattClient`/`ScaleBleService` implementation to ground the answer in what's actually shipped
rather than assumption.

**Findings, written up in full in [`docs/scale-ble-connect-latency.md`](../../scale-ble-connect-latency.md):**

- The "keep it primed" idea is already built: #972 (merged before #977, same day) made the
  connection persistent — held open indefinitely once linked, auto-reconnecting on a peer-drop
  without surfacing it to the UI. The captured log's `status=19` disconnect-and-recover was this
  working as designed, not a gap.
- The remaining constraint is physical, not architectural: the scale doesn't advertise BLE at all
  while idle (owner-measured: ~19s connectable window after a step-on, then dark), so no app —
  ours or Renpho's — can pre-connect before a real step-on wakes it.
- Stage-timing analysis of the captured log: the ~950ms gap between a cold connect (2206ms to
  link-alive) and a same-session warm reconnect (1270ms) lives entirely in raw GATT connection
  establishment, not in our own discover/subscribe/request sequence (which was ~590ms and nearly
  identical both times). Likely an Android BLE stack caching effect, not something our code
  controls directly.
- Renpho APK decompilation is parked, not started — no `adb` bridge to the device from this
  sandbox and no reason to speculatively pull a third-party binary from an untrusted mirror.
  Needs the owner to export and supply the actual file. Expectations set in the doc: given the
  hardware constraint above, it's more likely to reveal bonding/connection-parameter tuning (or
  nothing at all, i.e. the difference is UX rather than protocol) than an "always-primed" trick.

## Verified

- Nothing new to verify — no code changed. The doc's timing table is read directly from the
  owner's real on-device console capture.

## Not verified / still open

- The captured "warm" sample was an automatic same-session reconnect after a peer-drop, not the
  originally-reported "walked away, came back 30s later" manual-retry scenario — that comparison
  still needs to be captured.
- Whether bonding (`createBond()`) before `connectGatt()` would shrink the cold-connect stage —
  not yet tested; current code doesn't bond at all.
- The Renpho APK comparison — blocked entirely on the owner supplying the file.

Docs updated in this PR: new `docs/scale-ble-connect-latency.md`, linked from
`docs/domains/devices/README.md`'s reference-docs list, and the existing scale Known-Issues entry
in `projectOverview.md` updated with a pointer and summary rather than left saying "not yet
on-device tested" now that timing data exists.
