# 2026-08-01 — Restore the scale's stored-reading drain; add connect-stage timing diagnostics

Branch: `claude/bluetooth-scale-integration-jcuvs2` · v1.249.3

Owner rebuilt the APK after PR #976 and confirmed the retrying-toast fix on-device (no more
`state=retrying` line or stuck toast after a post-capture reconnect). Same test session raised a
new concern: connect/detect speed feels worse than the very first integration (#848), with the
owner describing needing to "prime" the connection — step on once, wait ~30s, then a second attempt
connects instantly. Investigated and shipped two responses.

## Finding: the stored-measurement drain request was silently dropped

Asked directly whether the docs covered pulling data the scale buffers on its own (relevant to a
missed live weigh-in). They do — but tracing the actual current code found the *request* side had
quietly stopped existing:

- **#969** (2026-08-01 08:19) added a second FFE3 write in `onServicesDiscovered`, asking the scale
  for any stored/offline measurements after the live-measurement request.
- **#970** (2026-08-01 11:36, "Defer the scale's FFE3 request write to a fallback path") rewrote
  that same function for an unrelated reason (deferring the *live* request write to a fallback-only
  path) and dropped the stored-request write and its backing `REQUEST_STORED_MEASUREMENTS_CMD`
  constant as a side effect — not mentioned in that commit's message.
- **#971** reverted #970's fallback-deferral (the live request goes back to firing immediately) but
  never noticed the stored-request write hadn't survived and didn't re-add it.

The receive side — `ScaleProtocol.parseStoredRecord`, `ScaleGattClient.onStoredReading`,
`ScaleBleService.postStoredReading` (POSTs to the existing `/api/scale-ble/samples` route via its
`measuredAt` field, no server changes) — was never touched by any of this and has been dead code
ever since, since nothing asks the scale for a stored record anymore.

**Fix:** restored `REQUEST_STORED_MEASUREMENTS_CMD` (`ScaleProtocol.kt`) and its write, queued
strictly after the live-measurement request (`ScaleGattClient.kt`'s `onServicesDiscovered`) —
functionally identical to #969's version. Still fully speculative/unverified against this scale's
actual firmware (ported from a third-party client for a related-but-not-identical scale variant,
per the constant's doc comment) — written to fail silently if the opcode isn't understood.

This directly targets the owner's "priming" complaint: the stored-drain's whole purpose is
recovering a weigh-in the live connection was too slow to catch, instead of it being lost outright.

## Added: connect-stage timing diagnostics

`ScaleGattClient` now logs elapsed milliseconds (from `connectGatt()`) at each pipeline stage:
gatt-connected, services-discovered, notify-subscribed, measurement-requested, and
first-FFE1-notification (`elapsedMs()`, new private helper). Purely diagnostic, no behavior change
— lets a "cold" first connect's log be compared stage-by-stage against a "primed" one on the next
test, instead of guessing between candidate causes (Home-screen-scoping race, GATT service-discovery
caching, or something else entirely).

## Verified

- **Not run in this session** — Kotlin-only changes, compile-gated in the sandbox (no Android SDK).
  CI's "Android (Kotlin tests + debug APK)" check is the real compile gate.
- `projectOverview.md`'s scale Known-Issues row updated with the #976 on-device confirmation and
  this session's two changes.

## Not verified

- **Both changes, on-device.** Needs a rebuild, then: (1) a cold app-open weigh-in to see whether
  the stage-timing log shows an obviously slow phase, ideally compared against a second attempt
  ~30s+ later; (2) confirmation that the stored-drain request either recovers a missed reading or
  (if the opcode guess is wrong for this exact scale) has no effect either way — no live-weigh-in
  regression either outcome.
- Whether the stored-drain request meaningfully changes the "priming" symptom at all — it's a
  plausible, direct fix for the specific "missed the live window" failure mode described, but the
  root cause of the perceived slowness hasn't been proven yet; the timing diagnostics are what
  should settle that on the next test.
