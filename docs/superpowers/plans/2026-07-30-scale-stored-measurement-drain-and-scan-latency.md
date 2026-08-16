# Scale: faster advertisement detection + speculative stored-measurement drain

2026-07-30. Owner-authorized in-session implementation (not a separate planning PR) — final
iteration on tonight's scale reliability work (#944, #947, #948, #949, #950).

## Problem

Two related asks: "fix the advertising" and "pull old saved data."

1. **Advertising detection latency.** `ScaleBleScanManager` registers its passive
   `BluetoothLeScanner` with `ScanSettings.SCAN_MODE_LOW_POWER`, which duty-cycles the BLE radio
   (long gaps between scan windows) to save battery. Given tonight's confirmed race theory — the
   scale's own local measurement cycle finishes faster than the phone's full
   scan-detect→connect→discover→subscribe→request pipeline, so the person often steps off before
   the request goes out — every millisecond spent *detecting* the advertisement in the first place
   makes that race worse. `SCAN_MODE_LOW_POWER` can add real, avoidable seconds to that detection
   step alone, on top of everything downstream.
2. **Stored/offline measurements.** Raised by the owner: does the scale buffer recent readings for
   later pull? A real third-party open-source BLE client for this exact scale family
   (`ronnnnnnnnnnnnn/renpho-escs20m`) confirms yes — see backlog Q-36 for the full source-reading
   trail. If the scale keeps a short history of recent weigh-ins (even ones the phone's live
   connection missed), draining it after every connection would provide a safety net independent of
   the race above: even a "failed" wake could still backfill the reading a few seconds later once
   the scale gets around to it.

## What's verified vs. guessed

**Verified independently** (their `const.py` matches our own `ScaleProtocol.kt` exactly for the
FFE0-layout variant, which is what our scale uses):
- `FFE1`/`FFE2`/`FFE3` roles (notify/indicate/command).
- The always-present 11-byte unparseable frame we've seen all session is a **display-unit
  request** (their `_OP_UNIT_REQUEST = 0x12`, matching our own Phase 0 note about a handshake
  frame with marker `0x12`) — not a stored record. That mystery is now resolved.

**NOT verified against our hardware — genuine guesses, carried over from a different opcode
family:**
- The stored-measurement query command itself: their library's opcode scheme (`0x20`/`0x22`/`0x1F`-
  prefixed) is for the FFF0-layout (primary) scale variant. Our own confirmed, 4-times-verified
  live-measurement request is `0x13`-prefixed (`REQUEST_MEASUREMENT_CMD`) — a different family
  entirely. There is no structural evidence their exact `0x22 0x04 vendor_byte` bytes work on our
  FFE0-layout hardware; it's a bet, not a fact.
- `vendor_byte`'s value — not defined as a constant in their `const.py`; guessed here as `0x15` by
  analogy with byte[2] of our own `REQUEST_MEASUREMENT_CMD`.
- The stored-record response frame's byte layout (weight/resistance endianness in particular) —
  only the timestamp was explicitly documented as little-endian; weight/resistance endianness is
  assumed big-endian (matching our own live-packet convention) purely by analogy, unconfirmed.

## Design principle: fail safe, fail silent

Given the above, this is written so a wrong guess costs nothing:
- The stored-measurement query is an *additional* GATT write, queued strictly after the existing
  live-measurement request — never blocks or delays the already-working live flow.
- `parseStoredRecord` returns `null` on anything that doesn't match the guessed marker/length,
  falling through to the existing (unchanged) "ignored — did not parse" path. If every byte here is
  wrong, behavior is identical to before this feature existed.
- If the scale doesn't recognise the query opcode at all, it should simply not respond (a normal
  BLE device response to an unknown command) — no crash, no side effect, no risk to the live path.
- Historical readings post through the ingest route's *existing* `measuredAt` field
  (`resolveMeasuredAt`, `packages/shared/src/validation/ingest-clock.ts`) — already used for
  reconciling a client-supplied timestamp against server time, already clamps to a 7-day window
  rather than trusting it blindly. No server-side changes needed at all.
- A stored-record POST losing a race with the service tearing down (`stopSelf()`) is an accepted,
  bounded risk for what's still an experimental feature — not worth new cross-callback
  coordination for a guess that might not even fire.

## Changes

1. **`ScaleBleScanManager.kt`** — `SCAN_MODE_LOW_POWER` → `SCAN_MODE_LOW_LATENCY`. Real,
   unambiguous latency win; the tradeoff is higher scan-radio power draw, accepted the same way
   the owner already accepted a longer worst-case retry window in #950 — reliability over battery
   for a background-sync feature that's opt-in and used a couple of times a day.
2. **`ScaleProtocol.kt`** — `REQUEST_STORED_MEASUREMENTS_CMD`, `StoredWeightPacket`,
   `parseStoredRecord()`. All marked speculative in comments, matching the honesty this whole
   integration has held to (Oura field names, HRV formulas — never trust a third-party byte value
   without device confirmation, but a docs-only investigation loop this deep into the night wastes
   the owner's remaining test cycles; ship a bet that self-disproves harmlessly and let the next
   real capture confirm or correct it).
3. **`ScaleGattClient.kt`** — queues the stored-measurement request after the live one; a
   `measurementTimersArmed` guard stops the *second* FFE3 write from re-arming
   `WEIGH_IN_TIMEOUT_MS`/`EARLY_DATA_TIMEOUT_MS` (both are keyed off "the FFE3 characteristic was
   written successfully," which is now true twice per connection — a real bug this change would
   otherwise introduce: a stray, uncancelled timer from the first write firing after a *successful*
   weigh-in already closed the connection, misreporting a spurious failure). Recognizes and routes
   stored-record frames via a new non-terminal `Listener.onStoredReading` callback.
4. **`ScaleBleService.kt`** — implements `onStoredReading`, POSTs each drained record independently
   via the existing ingest executor, without calling `stopSelf()` (see design principle above).

## What still needs on-device confirmation

Everything under "NOT verified" above. Concretely: does a `0x23`-marked notification ever arrive at
all? If yes, do the decoded weight/timestamp values look sane against what the owner actually
weighed at plausible past times? If the guess is wrong, this degrades to a silent no-op — nothing
regresses, and the raw hex logged for any unparsed frame (`FFE1 notification ignored — did not
parse as a weight packet (N bytes)`) still gives the next session real bytes to correct the guess
against, exactly like every other protocol detail in this integration.
