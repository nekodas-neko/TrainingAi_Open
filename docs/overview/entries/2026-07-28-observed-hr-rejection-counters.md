## 2026-07-28 — the HR card was reporting a counter that measured nothing

**Branch:** `fix/observed-hr-rejection-counters` · v1.227.2 · follow-up to #845 (Q-9)

### How it surfaced

The owner asked a good question about the Q-9 work: *"HR won't stay the same for 5 exact beats
would it? Is there an acceptable range or am I wrong?"*

The premise is right — heart rate varies continuously and never repeats a bpm exactly. The
algorithm doesn't need it to: `computeObservedHr` takes `desc[k - 1]`, the **k-th largest**
reading. That's an order statistic, so it needs no equality and no tolerance band. The confusion
was my own doing — the dev-server check in #845 seeded flat plateaus (200 readings at exactly 150),
which made it look like identical values mattered.

Quantifying the real cost of the order statistic on simulated 90-day data: the reported max sits
**3–5 bpm below the true peak** on 5-min ring bins and **~2 bpm** on 1 Hz strap data, tightening
the more hard sessions there are. That errs in the safe direction — a slightly low ceiling makes
efforts read harder, never easier — so it stays at k=5.

### The actual bug the question exposed

Checking the mechanism turned up something worse than a doc gap. `ObservedHrProfile.spikesRejected`
counted plausible readings strictly above the reported max:

```ts
const max = desc[k - 1]
const spikesRejected = desc.filter((b) => b > max).length
```

Since the max **is** the k-th highest, that count is `(k−1)` minus any ties at the max — 3 or 4 on
ordinary data — **whether or not a single artefact occurred**. It tracked the corroboration
constant and the tie structure, not sensor faults.

It wasn't an internal diagnostic. `components/health/observed-hr-card.tsx` rendered it as
*"N stray high readings ignored — your max is a level you've genuinely reached, not a one-off
blip."* So the card made a specific factual claim to the user that was untrue nearly every time it
appeared. In #845's dev check it read 4 and I reported that as "the 4 artefacts were rejected" —
coincidence, since I'd seeded exactly 4.

### What shipped

`spikesRejected` is gone, replaced by two values that carry signal:

- **`outOfBandRejected`** — readings discarded as physiologically impossible (outside 30–220 bpm).
  A healthy sensor produces none, so a non-zero value means something. Previously invisible: in
  #845's check, 50 readings at 250 bpm vanished with no trace but a lower `sampleCount`.
- **`highestPlausible`** — the single highest in-band reading. The gap to the corroborated max is
  the honest read on how spiky the top of the data is, left for the caller to interpret rather than
  compressed into a count that needed an invented threshold to mean anything.

Card copy rewritten accordingly: it states the max is a repeatedly-reached level and shows the
single highest reading beside it, with a separate amber line when readings were discarded as
impossible.

### Verification

Full suite **2,411 passing**, `tsc` + lint clean, both custom-rule checks OK.

Live `pnpm dev` against local Postgres, authenticated, with seeded `oura_heartrate` rows:

| seeded | result |
|---|---|
| 300 continuously-varying readings, no artefacts | `outOfBandRejected: 0` — **the old counter returned 3 here** |
| \+ 12 readings at 250 bpm | `outOfBandRejected: 12`, `sampleCount` unchanged at 300, `max` unchanged |

`/health/heart-rate` (the page rendering the card) returns 200.

A regression test pins the clean-data case at 0 specifically, since that is the exact scenario the
old counter got wrong.

### A correction I made mid-session, recorded because I nearly shipped the wrong conclusion

The full suite failed once on `lib/data/postgres/__tests__/oura-ble-sleep-window-union.test.ts`,
which passes on clean `main`, and I initially called it mine. It isn't: the test passes in
isolation, the Oura rollup never imports `computeObservedHr`, and two further full runs on this
branch were clean. It is a **pre-existing intermittent** under the full suite — logged in the
backlog rather than dropped, but not caused here.

### Not exercised

The card's rendered output on the S25. Web-only verification (the page returns 200 and the copy is
driven by unit-tested values); the change is JS-only and ships via Railway with no APK rebuild.
