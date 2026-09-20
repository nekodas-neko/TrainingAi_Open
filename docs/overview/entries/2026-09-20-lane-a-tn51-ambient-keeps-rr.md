# 2026-09-20 — TN-51: ambient wear kept one beat in thirty, so rMSSD was undefined

**Branch:** `lane-a/tn51-ambient-keeps-rr` · **Lane A** · seventh item of the session, straight after
TN-54 un-blocked the same device.

## What was wrong

`PolarStrapService` is built for all-day wear and runs overnight — its own header says so — and
`ambient` defaults to `true`. So a night in the strap goes through `thinAmbient()`, which kept one
buffered sample per `AMBIENT_GAP_MS` (30 s) and **dropped the rest whole, each discarded sample
carrying its own `rr` list.**

Confirmed live in production 2026-09-20 06:03–06:05 Brisbane: consecutive stored RR rows sat
**30.2 s, 30.2 s and 30.7 s apart** — `AMBIENT_GAP_MS` exactly — with **one RR interval per kept
sample**.

**That does not degrade rMSSD, it makes it undefined.** rMSSD is the root-mean-square of differences
between *adjacent* intervals; one interval every 30 s yields no adjacent pair at all. Which is why
this blocked PS-44's HRV comparison rather than merely weakening it: a disagreement measured that
way could not distinguish "the ring is drifting" from "the two devices sampled differently", and
that distinction is the entire question.

## What shipped — option (1), the entry's own preference

**Thin the HR samples; keep every RR interval.** The thinning is not the bug and is not removed —
it exists so all-day 1 Hz does not bloat `oura_heartrate`, and `rr_intervals` already spans 60 days
at 23 MB. What changed is that the dropped samples' beats ride forward onto the next kept sample.

**This is not an approximation.** `/api/hr-ingest` walks a sample's `rr` list *backwards* from
`sample.at`, subtracting each interval, so a kept sample carrying the whole window's beats lands
them across the window they actually occurred in. A test asserts that explicitly: 30 intervals of
1000 ms on one sample walk back ~29 s, they do not pile up on the timestamp.

**The server cap had to move with it.** `rr` was capped at 16 per sample; a 30-second carry holds
~30 beats at rest and ~100 at 200 bpm, so 16 would have rejected the very payload that fixes the
bug — and the client swallows a 400 and drops the batch, which is the same silent loss wearing a
different hat. Now 100, with the reasoning in place: **it is not the DoS bound and never was.**
`readJsonLimited` rejects at 512 KB before parsing, so total work is bounded by the body however it
is divided. A window above the cap **splits** into several samples rather than truncating.

## The part worth copying

The logic lives in **`PolarAmbientThinner`**, a pure object extracted from the service, with seven
unit tests — because this is the half no device check could isolate. A night of wear that produced
good data would not tell you whether the thinning or the mode was responsible.

The test that matters most is not "thinning happens" (it did before) but **no interval is lost**:
60 seconds of 1 Hz beats thin to 2 HR samples and must still carry 60 intervals.

One case the extraction surfaced that the old code would have kept losing: **a carry stranded by a
flush boundary.** The buffer flushes on a count threshold and on a timer, neither aligned to 30 s,
so a flush that keeps *nothing* is ordinary rather than exotic — and those beats would have been
dropped exactly as before. The pending carry therefore lives in the returned state, and a test
walks three flushes to prove it survives.

Two caps in two languages will drift, so a test reads the Kotlin constant and the route constant
and asserts they match. Nothing else compares them, and they sit in different toolchains.

## Verification

- **Server half:** 5 tests — the 30-interval accept, the backwards placement, the cap boundary both
  sides, and the cross-language guard.
- **Native half:** 7 Kotlin unit tests, run by CI's `Android (Kotlin tests + debug APK)` job.
- Full suite, `pnpm check:rules`, lint and typecheck below.

## CI caught four of my own tests, and the cause was worth the round trip

The first push went red on `Android (Kotlin tests + debug APK)`: **80 tests completed, 4 failed** —
all four mine, the 76 existing ones green. The required checks were all passing, so merging on those
alone would have shipped it.

The cause was one line. `lastSentAt == 0L` was the "nothing sent yet" sentinel, and my fixtures use
`at = 0` as a real timestamp — so keeping the first sample set `lastSentAt = 0`, the sentinel fired
again on the next sample, and **every sample was kept**: the thinning silently stopped.

**That is a real collision in code I was already touching, not a bad fixture.** It is unreachable in
production because `at` is `System.currentTimeMillis()`, which is exactly why it survived — and why
it only appeared once the logic became testable. So the fix is `Long?` with `null` meaning nothing
sent, which cannot be confused with a timestamp, rather than changing the fixtures to dodge it.
Production behaviour is identical; one test now pins the collision directly so it cannot come back.

The service's own field moved to `Long?` with it, including the `setAmbient` reset that used `0L`
to mean "keep the next sample".

**Stated plainly: the re-verification after that fix was done by reading, not by running.** Gradle
cannot resolve the Android plugin here, so all eight cases were traced by hand against the corrected
loop. CI is the executor.

## Not exercised

- **Gradle cannot run here** — confirmed, not assumed: `./gradlew testDebugUnitTest --offline`
  fails to resolve `com.android.tools.build:gradle`, `google-services` and the Kotlin plugin,
  exactly as CLAUDE.md describes. So the Kotlin tests were **written but not run locally**; CI's
  Android job is what executes them, and it is not a required check.
- **No strap, no night.** The entry's own pass test — a contiguous beat-to-beat series over the core
  sleep window, with `rmssdFromRr` comparable to the ring's figure — is owed and is in the `Keep:`.
  The logic is covered; the radio is not.
- **This needs a new APK.** Unlike the server half, `android/**` does not reach the device through a
  Railway deploy.
- **Two unverified native changes now stack.** TN-54 shipped hours ago and is also awaiting a device
  check. Both touch `PolarStrapService`, and the next night of wear exercises both at once — worth
  knowing when reading the result, because a bad night would not say which one.
