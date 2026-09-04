# 2026-09-04 — the scale's false "Weighing you…" bar, and a bar that finished early (Q-104, Q-114)

**Branch:** `fix/scale-weighing-ui-batch` · **Lane:** A · **Domain:** devices / body

Two owner-reported bugs, batched because each costs an APK cycle and neither can be verified here.

## Q-104 — the bar appearing on an empty scale

`onUnstableReading` treated every unstable reading as proof someone was standing on the scale, and
undid the post-capture suppression on that basis (`hasCapturedThisWake = false`) before force-firing
a fresh `waiting` state. It was the one path bypassing the entire suppression system built in
2026-08 to stop a reconnect-with-nobody-there from looking like a weigh-in.

The owner's second report carried the decisive detail without knowing it: a genuine capture at 5:46,
a fresh re-link at 5:47, and the bar showing at 5:47 with nobody newly on the scale. Cheap BLE
scales are documented to replay their last-buffered notification when a client resubscribes, and
returning to the Home tab re-links this service.

`ScaleWeighInGate.isNewWeighInEvidence(weightKg, lastCapturedKg)` now runs before anything else:
a reading identical to the wake's last capture is a replay, not a person.

**This is a candidate fix and the entry says so.** The backlog offered two gates — a time threshold,
or a same-value check — and the same-value one won for a reason worth keeping: a time threshold is a
number picked without data, which is the trap this repo keeps recording. The value check cannot fire
before a capture has happened this wake, and cannot fire on a reading differing by a gram. **If the
replay theory is wrong the gate never engages and nothing changes.** That is what made it safe to
ship without the on-device capture the entry had been waiting on since 2026-08-05.

`onUnstableReading` also logs the incoming and last-captured weights on **every** call now. The next
ordinary occurrence answers *"does the replayed reading match 71.0 kg exactly?"* from the device log,
rather than requiring someone to hold `chrome://inspect` open at the moment of failure — which is
why that question went unanswered for a month.

**Testable on purpose.** The gate is a pure object rather than a branch inside an Android `Service`,
so four unit tests run it in CI: a first reading of a wake is always new evidence, an identical
reading is not, a different weight is, and the tolerance is a gram rather than a rounding band.

## Q-114 — the progress bar finished four seconds early

`SCALE_CYCLE_BUDGET_MS` read 12_000 against the native `CYCLE_BUDGET_MS` of 16_000, under a comment
saying the two "must be kept in sync by hand". That comment describes how they drift.

Reconciled to 16_000, with `scripts/check-scale-cycle-budget.js` failing the Custom Rules job (now
**68 steps**) if they diverge again. Mutation-checked: restoring 12_000 fails it with both values
named.

**The bar got longer, which is the opposite of what the owner asked for, and is still the right
fix.** Its job is telling them how long to keep standing still; under-reporting that invites stepping
off while the service is still retrying, losing the weigh-in the bar exists to protect.

**The trim they actually asked for is still owed**, and the entry records why it needs a capture:
both 12s and 16s are the retry give-up ceiling, and neither is how long a weigh-in takes. The
2206ms/1270ms figures in `scale-ble-connect-latency.md` are link establishment only — using them to
pick a bar duration would be measuring one thing and reporting another.

## Not exercised — and this one matters

**Neither change has been on a phone.** No Android SDK here and Gradle is proxy-blocked, so the only
gates are CI's Kotlin unit tests and APK build. A `projectOverview.md` Known-Issues row records that,
with what to watch on the next APK: the bar not appearing on a plain Home-tab visit with an empty
scale, and a genuine weigh-in still drawing one.

No server, no database, no production data.

## Gates

`tsc --noEmit` clean · `pnpm check:rules` 68 of 68 · full JS suite 757 passed | 5 skipped (762
files), 6443 tests passed · Kotlin unit tests run in the Android CI job.
