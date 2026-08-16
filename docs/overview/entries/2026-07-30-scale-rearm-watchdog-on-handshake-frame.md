## 2026-07-30 — Re-arm the early-data watchdog on the scale's handshake frame

Follow-up to #944 (early-data watchdog, v1.246.6) and #947 (diagnostic logging). The owner rebuilt,
confirmed the watchdog fix's source was actually in the binary, and re-tested — the original bug
still reproduced: a fresh weigh-in timed out at the full 30s with zero visible notifications.

### What #947's diagnostic logging revealed
Added a log line for any `FFE1` notification that fails `ScaleProtocol.parseWeightPacket` (the
"malformed or the auto handshake frame" case the original comment already flagged), instead of
silently dropping it. The owner then did 4 weigh-ins within about a minute and captured the console
each time:

- 2 of 4 got the handshake frame (`FFE1 notification ignored — did not parse as a weight packet (11
  bytes)`), immediately followed by a real unstable → stable reading. Success.
- 1 of 4 got only the handshake frame, then genuine silence for the rest of the 30s window — the
  exact bug, now proven with direct evidence instead of a log-inspection theory.
- 1 of 4 failed a different way (`connectionStateChange status=19` — the scale itself terminating
  the connection mid-measurement), which the existing 2-attempt/cooldown retry policy already
  absorbed correctly. Left as a separate, not-yet-investigated failure mode.

The scale reliably sends this same always-11-byte frame first, on every connection, before any real
reading — it's a consistent protocol detail, not an occasional glitch.

### Root cause and fix
`onCharacteristicChanged` called `cancelEarlyDataTimeout()` unconditionally for *any* `FFE1`
notification, including the handshake frame — retiring the watchdog for good the moment it saw
proof the subscribe worked, with no further protection if a real reading never followed. Changed it
to re-arm (`cancelEarlyDataTimeout()` + `startEarlyDataTimeout()`) instead of just canceling when the
notification doesn't parse. The outer `WEIGH_IN_TIMEOUT_MS` (30s) runs as its own independently-
scheduled timer and is never touched by this, so a connection that keeps receiving only junk frames
still can't be stalled past the original 30s ceiling — it just gets caught sooner if the junk frame
is the last thing that ever arrives.

### Version bump
1.246.7 (patch — bug fix).

### Not yet confirmed
Compile-reviewed only — no Android SDK/Bluetooth hardware in this sandbox. Needs the owner to
rebuild and repeat the same rapid-succession weigh-in test to confirm the previously-failing case
now recovers within ~8-16s of the handshake frame instead of the full 30s.
