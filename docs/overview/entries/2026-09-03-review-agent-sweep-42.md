# Review sweep 42 — first-run honesty, and instant paint on the screens that actually unmount

**Date:** 2026-09-03 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-42` · Docs only.

Sweep 41 left two coverage questions, both about screens the existing guards do not reach. This is
those two.

| ID | What |
|---|---|
| **RV-38** | Body Battery prints 50 and calls it "Good" for an account with no data, while the route says `hasData: false` |
| **RV-39** | The `/more/devices` ring card flashes a skeleton for ~1.2 s on a warm repeat visit |

**RV-38 is the one worth reading.** `GET /api/body-battery` for the zero-data account says, in four
separate fields, that it has nothing: `hasData: false`, `sampleCount: 0`, `samplesPerHour: 0`,
`sufficient: false`, `anchorSource: "default"`. The card renders **Good / Steady / 50** with a
colour-coded label, a bar filled to 50%, and no "Limited data" badge.

The guard exists and excludes the case by construction. `body-battery-card.tsx:95` reads
`battery.hasData && conf != null && !conf.sufficient`, so too-few-samples gets the warning and
no-samples-at-all gets nothing — the qualification is weakest where the data is worst.

**The contrast is on one screen, for one account.** Streak `—days`; the week grid `—` on all seven
days; the Readiness/HR/Sleep chip row absent entirely; `/health/readiness` reading `—`. Only Body
Battery prints a figure — and Readiness is the number it opens at, by the card's own explainer.

This does not reopen Q-43. Degrade-rather-than-blank stands; the narrow point is that the app already
computes "I cannot support this number", already has a component that says so, and does not use it
where it is most true.

**Two lenses came back clean and are recorded as results.** Instant paint holds on the sub-routes —
13 of 14 measured `[0,0,0,0]`, which is the half of the rule nothing guarded, since
`tabs-instant-paint.spec.ts` covers the five tab screens and those never unmount. And the first-run
state is honest on 21 of 22 routes: no 5xx, no `pageerror`, no console error, no permanent skeleton,
and empty states that name the next step rather than showing a generic blank. Zeros appear only where
zero is the true count.

**One near-miss recorded rather than filed:** `/cardio` shows `60 RESTING` for the zero-data account —
the documented default, not a measurement — but carries its own *"Still learning your range"* caveat
one line below, which is exactly the qualification Body Battery lacks.

**Not exercised:** the device — this is the web build, where `getLocalStore()` returns null, safe-area
insets are zero, and the ring card's real BLE state is unreachable, which is why RV-39 carries a
device verify. Production was not queried.

Write-up:
[`docs/reviews/2026-09-03-first-run-honesty-and-instant-paint.md`](../../reviews/2026-09-03-first-run-honesty-and-instant-paint.md).
