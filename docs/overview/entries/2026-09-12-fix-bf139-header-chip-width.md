# 2026-09-12 — Home's three header chips fit the column they have (BF-139)

**PR:** `fix/bf139-header-chip-width` · **Lane B** · `components/device-battery-chip.tsx`,
`components/weather-chip.tsx`, `components/home/header-chips.tsx`,
`components/home/__tests__/header-meta-row-overflow.test.ts`.

Owner, with a screenshot: *"the pills in the top are a little cutoff. can we make them smaller to
fit?"*

## The entry's numbers were estimates, and they were low

BF-139 reasoned about this row by counting characters and pixel-guessing padding. It put the left
column at ~232 px and the three chips at ~201 px — which would leave 31 px spare and no bug.

Measured instead, by injecting the exact pill markup into the live header row at 412 dp and reading
`getBoundingClientRect()`:

| | before | after |
|---|---|---|
| left column | **224 px** | 224 px |
| night, no UV | 226.9 — **2.9 over** | 156.1 — 67.9 spare |
| daytime, `UV 5` | 271.0 — **47 over** | 200.2 — 23.8 spare |
| daytime, `UV 11` | 279.4 — **55.4 over** | 208.6 — 15.4 spare |

227 px of chips in a 224 px column is exactly the screenshot: the date has already truncated to
nothing and the pills sit flush against the `overflow-hidden` clip.

## Which makes the prescribed fix insufficient — as the entry itself warned

BF-139 proposed trimming `px-2.5` → `px-2` on the battery chips, *"~8 px across the two"*, and then
said to check it against the daytime case. Checked: the lever is worth 4 px a pill and 12 px across
all three, because the weather chip carries the same padding. That clears the night case and leaves
the daytime case **43 px over**.

The trim ships anyway — it is free, and it is the lever the owner actually asked for. It is just not
what makes the row fit.

## What makes it fit is one pill instead of two

Two separate battery pills cost **150 px** of a 224 px column — 67% of the row — to show two
numbers. Merged into one pill they cost **91 px**. A pill boundary is two horizontal paddings and a
gap, and the row could not afford to pay that twice. Dropping the drawn `%` is the other 12 px a
reading; a number beside a battery icon already reads as a percentage, and the full text stays in
the accessible name, so the colour-only-state rule is untouched.

**The merge is not free, and the part that needed care is staleness.** `opacity-50` used to dim a
whole pill. With two devices sharing one, dimming the container would report a fresh reading as
stale, so it moved onto each device's own span.

## Verification

Full unit suite **696 files / 8,426 tests green**; `pnpm check:rules` **Ran 73 of 73**; production
build clean; lint clean in every touched file.

The guard test gained four assertions pinning the arithmetic rather than only BF-96's wrap fix —
one `rounded-full` in the battery chip, no drawn `%`, one `opacity-50`, `px-2` on both weather
pills. **Three mutations were run and each was caught**: putting `%` back, reverting the padding,
and dimming the container instead of the span.

**No E2E spec, deliberately.** The seeded database has no weather snapshot, so `WeatherChip` renders
only its skeleton and the three-chip row cannot be assembled from real data in the harness — the
same limitation BF-96 recorded. The measurements above came from injecting markup, which is a fair
way to measure CSS and a circular way to test a component, so it stayed a probe and did not become a
spec. The mutation-checked source guard is the standing protection, as it is for BF-96.

**Not exercised:** the S25. The device look is the whole of what BF-139 still owes, and it wants the
daytime case with `· UV n` present rather than whatever the hour gives.

## What CI caught that the local gate could not

`e2e/home-device-battery-chips.spec.ts:52` asserted `toHaveText('72%')` — the drawn `%` this change
removes. Expected, and the assertion is now `'72'`; the accessible name still carries the full text,
which is the half that has to stay true.

**But the same spec caught something that was not expected, and it is the more interesting half.**
The first version of the merge put one joined `aria-label` on the pill —
`devices.map(describe).join('. ')`. With only a strap reading the spec's
`getByLabel('Strap battery 72%')` still matched, so it would have shipped looking correct. Add a ring
reading beside it and the label becomes *"Ring battery 88%. Strap battery 72%"*, that locator stops
matching, and a screen reader gets one run-on sentence for two independent facts.

Each device now carries its own name on a `role="img"` span. The role is load-bearing rather than
decoration: an `aria-label` on a generic element is ignored by assistive technology, so the fix would
have read correctly in the diff and announced nothing. The guard pins all three properties and the
mutation — restoring the joined label — was run and caught.

**The run also produced LB-56's sixth sighting, and its worst:** two `SIGSEGV`s at the familiar
address and four flaky in one 26.1-minute job, with `preferences-survive-reinstall:36` the hard
failure for the third time. `touch-target-size:53` reported *"no interactive elements found"* — the
dead-renderer downstream wearing a third mask, and the only one of the three that looks like a
genuine product failure on its own. Recorded on that entry rather than fixed here.

**The first push never triggered CI at all.** `get_check_runs` read `total_count: 0` and so did
`actions_list` — `main` had moved to `558a314205` while the local gate was running, taking #1107
(*"Carry the strap battery reading's own time to JS"*) with it, which touches the very hook this
change consumes. Merging it in and re-pushing started CI within seconds. The hook's shape is
unchanged, so the merge was clean; the near-miss was that a Lane A change to `useStrapBattery` landed
mid-flight on the one component this PR rewrites.
