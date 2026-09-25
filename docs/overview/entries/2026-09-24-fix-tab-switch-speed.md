# 2026-09-24 — tab-switch-speed: the blank is gone, the block is not

**Branch:** `fix/tab-switch-speed` · **Lane B** (LB-144) · batch `tab-switch-speed`, **half shipped**

The owner named tab-switch speed his highest priority. The batch was four entries: two work
(`RV-113`, `DV-12`) and two evidence (`OR-161`, `OR-162`). **`RV-113` and `OR-161` shipped. `DV-12`
and `OR-162` did not, deliberately** — see the last section, which is the substantive part of this
entry.

## What shipped

**`RV-113` — the opacity ramp is gone from `ta-tab-enter`.** The outgoing panel is hidden in the
same React commit that reveals the incoming one, so an incoming ramp from `opacity: 0` played over
an empty screen: a per-frame sampler on the S25 caught 58–109 ms with neither panel painted, on 10
of 10 switches. Material 3's fade-through fades the *outgoing* content out first and that half was
never implemented, so the ramp was the second half of a cross-fade with no first half. The scale
settle stays.

**Kept `scale(0.96)`, not the `0.97` the entry and its relay both specified.** The scale was never
part of the defect, and the comment beside it records why 0.96 was chosen over the spec's 92% — a
full-screen panel makes 92% read as a zoom. Changing a deliberately-chosen value while fixing an
unrelated one is how the reason gets lost.

**`OR-161` — the two comments that asserted the defect could not happen.** `globals.css` claimed the
animation ran over "content that is already painted"; `tab-shell.tsx:186` claimed "content that is
genuinely there". Both were false and both are why it survived review. Rewritten to say what is
actually true and why re-adding a ramp re-opens RV-113. OR-161's other half — that the route
transition 50 lines above already holds a deliberate ~15% overlap — is what made the fix a deletion
rather than a design.

## What did not ship, and why that is the right call

`DV-12` holds the actual time: one long task of 68–118 ms on every tab tap, profiled on the S25 to
chart.js `update → _tickSize → _computeLabelSizes → set font`. `OR-162` established the mechanism
from source — hidden panels carry `[content-visibility:hidden]`, so on reveal every `<canvas>` goes
from no box to a real one and the responsive resize observer fires. It offered three fixes and said
none was measured, and that **the count of canvases mounted across the five tabs should be taken
first**, because its cheapest option only pays if the cost is many charts rather than one expensive
one.

**I took that count, and the question turns out to be wrongly posed.**
`e2e/or162-canvas-census.spec.ts` drives the real app at 384 px, visits every reachable tab, and
counts. With four panels mounted it read **0 canvases — none hidden, none active.**

The zero is not the harness failing. **No chart is unconditional in a tab panel.** Charts reach one
only through the owner's configuration and data: Home via `home-card-widget.tsx` → `HrDayChart`,
Health via `health-sections.tsx` → `TimeInZoneCard`, `trends-section.tsx` → `TrendChart` and two
`TrendSparkline` cards, Nutrition via `day-tools-section.tsx` → `WeeklyNutritionChart`. And
`TrendSparkline` is `dynamic(ssr: false)`, so it is not in the bundle until something renders it.

So there is no single number to take, and "many cheap charts or one expensive one" **cannot be
settled off-device** — it depends on which Home widgets the owner has enabled and which Health
sections have data. Both entries now say so, and DV-12 says the canvas count and the long-task
measurement must be taken in the *same* sitting, because either alone is useless.

Shipping a speculative chart.js change into the owner's highest-priority path, against a defect that
does not reproduce in the harness, with no way to measure whether it helped, is the exact shape
CLAUDE.md calls "verified but broken". One direction was also cheaper on paper than in fact:
OR-162's option (b), holding the canvas size across the hidden state, cannot be done with
`contain-intrinsic-size` — that sizes the contained element, not the descendant canvases, which
still have no box. It means JS. That is recorded too.

## The spec

It asserts the invariant both entries rest on — every hidden panel carries a computed
`content-visibility: hidden` — and logs the census. It deliberately asserts **no** canvas count:
that would either pin the seeded account's poverty or break the moment the seed gains data.

## Verification

`pnpm check:rules` **Ran 78 of 78, all passed** · `tsc --noEmit` clean · `pnpm test` full suite ·
`pnpm build` clean · the census spec passes against the running app.

**Not exercised: the device.** The Device Verification session is archived. RV-113 is a perceptual
change to the app's most frequent interaction, so what it needs is a *look*, not a measurement —
and `projectOverview.md` carries the Known-Issues row saying so. That row also warns off the obvious
wrong check: `perf.js longtasks` will show no improvement from RV-113, because it removes a blank
and not a delay. Reading that as a failed fix is the mistake the batch was assembled to prevent.
