## 2026-07-30 — Scale: faster advertisement detection + speculative stored-measurement drain

Final iteration for tonight's scale reliability arc (#944, #947, #948, #949, #950). Owner asked
directly: "let's fix the advertising and pull old saved data," with explicit authorization to
implement and merge without a separate planning PR. Full reasoning in
`docs/superpowers/plans/2026-07-30-scale-stored-measurement-drain-and-scan-latency.md`.

### Advertising detection latency
`ScaleBleScanManager` was registering its passive scan with `ScanSettings.SCAN_MODE_LOW_POWER` —
battery-friendly, but duty-cycled, adding avoidable seconds to *detecting* the scale's
advertisement in the first place. Given tonight's confirmed race theory (the scale's own
measurement cycle finishes faster than the phone's full connect pipeline), every millisecond spent
just noticing the advertisement makes that race worse. Changed to `SCAN_MODE_LOW_LATENCY` — real,
unambiguous win, accepted battery tradeoff for an opt-in feature used a couple of times a day.

### Stored-measurement drain (speculative)
The owner pointed at a real third-party open-source BLE client for this exact scale family
(`ronnnnnnnnnnnnn/renpho-escs20m`). Reading its source directly (not from memory) confirmed:
- Its `const.py` defines the exact same FFE1/FFE2/FFE3 roles as our own `ScaleProtocol.kt` for its
  FFE0-layout variant (independent cross-confirmation of Phase 0's original capture).
- Its `_OP_UNIT_REQUEST = 0x12` opcode matches our own "always-11-byte unparseable handshake
  frame" exactly — that mystery is resolved: it's a display-unit request, not a stored record.
- It documents a genuine offline-measurement-store mechanism (`_OP_STORED_MEASUREMENT = 0x23`,
  triggered by `bytearray([0x22, 0x04, vendor_byte])`).

Its opcode family doesn't match our own confirmed, 4-times-verified live-measurement request
(`0x13`-prefixed) — different firmware/scale generation — so the exact bytes are **unverified
against our hardware**. Implemented anyway, as an explicit, owner-authorized bet, written to fail
silently if wrong:
- `ScaleProtocol.kt`: `REQUEST_STORED_MEASUREMENTS_CMD` (guessed bytes), `StoredWeightPacket`,
  `parseStoredRecord()` — all marked SPECULATIVE in doc comments. Synthetic unit tests added
  (`ScaleProtocolTest.kt`) — unlike every other test in that file, these use constructed byte
  arrays, not a real capture, since none exists yet; they verify the decode arithmetic is correct
  for the guessed layout, not that the guess matches reality.
- `ScaleGattClient.kt`: queues the stored-measurement request after the live one (never delays the
  working flow); a `measurementTimersArmed` guard stops the second FFE3 write from re-arming
  `WEIGH_IN_TIMEOUT_MS`/`EARLY_DATA_TIMEOUT_MS` a second time (a real bug this change would
  otherwise introduce — both timers are keyed off "FFE3 write succeeded," now true twice per
  connection); routes any `0x23`-marked frame to a new non-terminal `onStoredReading` callback.
- `ScaleBleService.kt`: implements `onStoredReading`, POSTs each drained record via the *existing*
  `/api/scale-ble/samples` route's `measuredAt` field (`resolveMeasuredAt`,
  `packages/shared/src/validation/ingest-clock.ts`) — already built for exactly this (a
  client-supplied timestamp, clamped to a 7-day window). **No server-side changes needed at all.**
  Does not call `stopSelf()` (unlike the live path) since it can fire multiple times per
  connection and must not tear the service down mid-drain.

If the guessed command/opcode is wrong, this degrades to "no stored records ever decoded" — the
existing live-weigh-in flow is completely unaffected either way.

### Version bump
1.246.9 (patch — reliability improvement + speculative feature, both flagged not-yet-verified).

### Not yet confirmed
Compile-reviewed only — no Android SDK/Bluetooth hardware in this sandbox. Needs the owner to
rebuild and report: (1) does weigh-in detection feel faster / register more reliably on the first
attempt now, and (2) does a `0x23`-marked stored record ever actually arrive in the console log —
if so, do the decoded weight/timestamp values look sane against what was actually weighed at a
plausible past time. If the second one never fires, that's useful negative evidence for backlog
Q-36, not a regression.
