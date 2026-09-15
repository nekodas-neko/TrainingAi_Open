# 2026-09-15 — OR-116: one metric name over two metrics

**Branch:** `fix/or116-resting-vs-intraday-hr` · **Lane B**

The owner, comparing two screens: *"I dont see any other values that match that home screen HR value
— current = 73, min = 50, average = 89, max = 125, and the HR card says 60."*

**Every one of those numbers was right.** Home's 60 is last night's **resting** rate
(`body_metrics.resting_heart_rate`); the 73/50/89/125 are today's **intraday** series. Both screens
called their figure "Heart Rate", and nothing said they were different things — so a user comparing
them can only conclude that one is broken.

This is the failure mode where there is no bug to find. Checking the arithmetic confirms both sides
and explains nothing, which is roughly what the entry's author did before filing it.

## What shipped

Home's chip reads **"Resting HR"**; the detail screen's four stats are captioned **"Today so far"**.

**The Home label follows the source, and that conditional is the part worth keeping.** The value is
`restingHrLastNight ?? restingHr ?? hrCurrent`, and the third fallback **is a different metric** —
`hrCurrent` is a live BLE sample, a desk reading rather than a night. Labelling it unconditionally
"Resting HR" would have moved the false claim instead of removing it, which is the same mistake the
entry was filed about, one layer down.

The wording is Health's existing one: `rhr-hrv-spo2-card.tsx` already renders "Resting HR" at the same
9px uppercase treatment. Three names for one signal was the problem; a fourth would not help.

## Measured, not eyeballed

"Rest HR" is the longest short label in a four-cell row, so the spec measures with
`getBoundingClientRect()` that no child exceeds its cell and the document does not scroll sideways at
phone width. A label that wrapped or clipped would be a new defect traded for the old one — and at
8.5px with 0.16em tracking that is exactly the kind of thing a green functional assertion misses.

Both tests fail against `main`.

## Found while reading, deliberately not fixed

`app/health/heart-rate/page.tsx` passes `restingHr={data?.hrMin ?? null}` into `HrFactorsCard` —
today's intraday **minimum** standing in for the resting rate. On the owner's own figures those are 50
and 60, so they are not the same number. That is a **fourth** presentation of this signal and
possibly a real defect rather than a naming one.

Not touched here: it changes what a card computes from rather than what it is called, and whether
`hrMin` is a deliberate proxy or an oversight has to be established before it is "fixed". Recorded on
the entry as a `Keep:`.

## What labelling did not solve

The entry was filed on a three-surface problem: Health's tile shows the value bare, Home's shows it
with a delta against baseline, the detail screen shows neither. **Three surfaces, one number, three
amounts of context.** Naming each surface stopped the numbers reading as broken; it did not decide
what each surface is *for*. That stays open, and it is a design question rather than a defect.

## Not exercised

**No device pass**, and the label change is exactly the kind that wants one — the short label only
renders in the band ring style, and the owner's chosen style decides whether "Rest HR" is ever on
screen at all.
