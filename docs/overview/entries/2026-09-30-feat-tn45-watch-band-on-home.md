# 2026-09-30 — TN-45: the only illness band that has ever fired now has somewhere to appear

**Branch:** `feat/tn45-watch-band-on-home` · v1.486.8. The Lane B render; the engine half shipped
2026-09-18.

`watch` is the illness radar's quietest band — **no readiness penalty**, so nothing on Home moved —
and it had no UI at all. The render guard in `illness-advisory-banner.tsx` returned `null` for it.
Two real firings (2026-09-16 score 41, 2026-08-27 score 57) reached the owner as silence.

Third item off the KEEP list this session, and the reason that list keeps paying: TN-45's residue
read *"the RENDER, which is the Lane B half and the whole remaining ask"* — buildable, fully
specified, and sitting under `next-item.js`'s *"Not new work"* heading.

## Two tiers, and the quiet one is the owner's call rather than a shortcut

| band | penalty | treatment |
|---|---:|---|
| `watch` | **0** | a quiet 11 px line under Home's score chips |
| `elevated` / `fever` | 6+ | the existing bordered advisory, with its label and `readiness −N` |

A bordered advisory would overstate `watch` on every firing, which is how a banner gets tuned out
before the band that matters uses it. Same two-tier reasoning as `SleepAnnouncement`'s `prominent`,
and one component still owns the Home illness surface — a second would be a place for the two to
drift, which is `RV-208`'s whole class.

**The quiet tier shows no band label and no suppression figure.** `elevated` and `fever` are words
that mean something to a reader; *"Watch"* beside a neutral sentence reads as an instruction the
band does not carry. And it is a plain `<p>`, not a second `role="status"` on Home — a bordered
advisory appearing is a status change worth announcing, an ambient note under the scores is not.

**The copy is `illnessAdvisory`'s and is never re-worded at the surface.** `TN-46` established that
the 09-16 firing was Retatrutide (0.5 mg from 09-07, 1 mg from 09-13) tracking through resting HR and
HRV with a 2–4 day lag — **not illness** — so the line must name *what moved* and must never imply
infection. A source test pins the absence of a literal sentence in the `watch` branch, because that
constraint would otherwise have two homes with only one of them under test.

It reuses the type-scale token (`text-2xs`, RV-209's 11 px floor) rather than a literal, and matches
the chip row's own *"Scores didn't load"* line above it — same gutter, same size, same muted colour —
so it reads as a note about the scores rather than furniture of its own. RV-209's guard only scans
`components/workout/`, so nothing would have stopped a `text-[11px]` here.

## ⚑ And the entry's one unexplained day turned out to be a known data defect

TN-45 recorded 2026-08-27 as having *"no explanation on file"* — `TN-46`'s account covers only 09-16,
and that day carries an HRV z of **−4.26**, which is extreme. Read from production while closing the
entry:

| day | flag | score | contributors |
|---|---|---:|---|
| 2026-08-27 | `watch` | 57 | `hrvBalance z −4.26` (25) · `restingHeartRate z +2.84` (32) |
| 2026-09-16 | `watch` | 41 | `hrvBalance z −3.42` (15) · `restingHeartRate z +2.91` (19) · temp, breathing |

**`PS-17` records 08-27's stored summary as `4.75 h / HRV 26.5 / RHR 73.7`** — a phantom *afternoon*
window classified as night — and states *"Only 08-27's summary was ever wrong."* A daytime window has
lower HRV and higher heart rate than a real night, so the corruption predicts **both of that day's
contributors, in both directions.**

Stated at that strength and no further: the z values were not recomputed from 26.5/73.7 against the
baseline, so this is a hypothesis **confirmed in field and sign, not in arithmetic**. Written into
both entries, because the consequence is `PS-17`'s: until its corrective recompute runs, a false
`watch` stays in the history and any later validation of this band reads it as a real firing. **The
usable history for `watch` is one day, not two.**

## Verified

- `components/home/__tests__/tn45-watch-band-on-home.test.ts` — **6 tests**: the shared copy names
  what moved and never implies infection, the guard no longer drops `watch`, the branch renders
  `readiness.illnessAdvisory` rather than a literal, no band label or suppression figure, the live
  region stays on the prominent tier only, and the type token rather than a pixel literal. Matched on
  **code with comments stripped**, because the component's docstring discusses `watch` at length and
  a word match would pass on the docstring alone (the `Q-231` shape).
- `e2e/tn45-watch-band-on-home.spec.ts` — **3 passing** at 412 px dark, and the first two are the
  entry's pass test verbatim: *a `watch` day produces something the owner can see on Home, and a
  normal day does not.* The line is asserted **under the readiness chip** by bounding box, because a
  line rendered at the bottom of Home would pass a bare visibility check and fail the entry; and its
  wrapper's `border-top-width` is asserted `0px`, so the quiet tier cannot quietly become the card.
  The third holds the `elevated` tier intact — label, penalty and `role="status"` — so the new branch
  cannot have swallowed it.
- **Control-run.** Removing the `watch` branch reddens **only** the starred e2e test (the other two
  stay green) and **3 of the 6** source assertions.
- `npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 86 of 86** ·
  `check-memo-prop-stability` clean · `check-e2e-route-tolerance` clean · `pnpm test` · `pnpm build`.

The e2e overlay patches the real readiness payload (`route.fetch()` + spread) because Home hands most
of it to the chip row and the Body Battery card — which means `tolerateTestEnd`, for the second spec
in a row.

## Not exercised

- **A real firing.** Every render is from an overlaid payload, there have been two `watch` days ever
  and none since 09-16, and one of those two was `PS-17`'s phantom. Filed as a Known-Issues row
  rather than kept as backlog work: it is an event to observe, and `LB-166`'s lesson is that a
  residue waiting on an event blocks instead of waiting.
- **The device.** One 11 px line on Home, measured under the chips at 412 px in Chromium. No layout
  moved and nothing else shifted, so nothing is filed as owed — but Samsung WebView's metrics are not
  Chromium's and 11 px is the floor of the scale.
- **The thresholds.** Untouched, deliberately, and the entry's two "do not" warnings are intact: no
  threshold moved and `watch = 0` stays. `Q-506`'s re-derive is where that risk lives.
