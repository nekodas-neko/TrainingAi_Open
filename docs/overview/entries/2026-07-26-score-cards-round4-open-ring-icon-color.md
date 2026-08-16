## 2026-07-26 — Score-cards rounds 4-5: five ring styles, coloured icons, list picker (v1.209.0)

Fourth round of the core score-cards overhaul, this time purely visual (no scoring/formula changes).
The round-3 fixed-accent-tick ring didn't land with the owner on review, so this round went through
two more mockup passes before writing code — six shapes (circle/square/diamond/hexagon/chamfered
square/no-frame), then five more minimal ideas (corner brackets, open ring, perforated ring, corner
dots, underline-only) — before the owner converged on a final set of ring styles across two follow-up
clarifications (the second explicitly asking to keep the round-3 design available too, not discard it).

**Design landed on:**
- **Remove all colour from the ring.** The accent arc is gone; every ring style is a plain neutral frame.
- **Move the colour to the icon instead** — each card's icon is now tinted its identity colour
  (readiness `#60a5fa` blue, HR `#f87171` red, sleep `#a78bfa` purple, activity `#f97316` orange —
  same hexes as round 3, just relocated from the ring to the icon; sleep was nudged from the original
  shipped indigo `#818cf8` to a clearer purple across the mockup rounds, confirmed by the owner not
  objecting across several subsequent review rounds).
- **Remove the dot.** State (good/moderate/low) is no longer shown visually on the home row at all —
  this was flagged explicitly to the owner mid-mockup (screen readers still get it via `aria-label`;
  sighted users read the number itself or tap through to the detail screen) and accepted as the
  tradeoff, not a silent regression.
- **Bigger circles.**
- **Four finalist frame shapes**, not two — two follow-up clarifications each added another option after
  the owner asked to keep old designs selectable rather than lose them outright: **Default** (a plain
  closed circle, no gap, no dots — this is literally what round 4's first "Option 1" mockup looked like,
  before the shape-exploration rounds), **Open ring** (a circle with a deliberate gap, never reading as
  "complete"), **Perforated ring** (small dots tracing the circle, texture instead of a stroke), and
  **Accent ring** (the fixed-accent-tick design that was actually live on `main` just before this round —
  thin track + coloured arc + white icon + coloured dot, a different content model from the other three,
  kept selectable so the switch to the new default is reversible).

**"Maybe give the user those options?"** — the owner's own idea, prompted by seeing so many viable
shape mockups: rather than pick one winner, ship a real **user preference**. Built as `ScoreRingStyle`
("default" | "openring" | "perforated" | "accentring") in `lib/home/home-prefs.ts` (`loadScoreRingStyle`/
`SCORE_RING_STYLE_KEY`/`SCORE_RING_STYLES`, following the exact existing pattern other home preferences
already use — e.g. `loadWeightLookback`). Default is "default" (the plain circle).

**Toggle → list, mid-round.** The picker first shipped as a 2-button segmented toggle (matching the
existing "Weight Sparkline" 7d/30d control right above it in the same settings section) — but once the
third "Default" option was added, the owner asked for a proper **vertical list** instead ("as there is a
fair few choice options"). Rebuilt as a `role="radiogroup"` of full-width rows in
`components/more/home-widgets-section.tsx`, each showing the style name + a one-line description, with
a checkmark on the selected row — no existing precedent for this exact pattern elsewhere in
Profile/More, so it was built fresh but styled consistently with the existing pill-toggle rows above it
in the same panel (`border-brand bg-brand/10 text-brand` active state, same as the "Home Sections" pills).

**Why each style keeps its own size** (a real finding from the owner's own feedback — "the larger size
looks better with open ring but doesn't work well with the other options"): perforated dots need to sit
closer together to read as a continuous texture, so shrinking the dot count/spacing to fit a bigger
diameter makes it look sparse and broken rather than "perforated." The two plain-stroke shapes (default,
open-ring) scale identically well, so they share the larger size; perforated gets its own smaller tuned
geometry, and accent-ring keeps its original (smaller, 80px) size rather than being stretched to match
the newer styles (`RING_GEOMETRY` lookup in `components/oura-score-chip-row.tsx`: default/open-ring
114px, perforated 94px, accent-ring 80px).

**Verification:** `tsc` clean, lint clean, full suite **1952 passing** (no new formula tests needed —
this is pure rendering/preference logic). Dev-server + Playwright screenshots and DOM-structure checks
on the seeded user confirmed: (1) all four ring styles render at their correct sizes — the accent-ring
addition reproduces the exact prior-`main` geometry (track circle + one fixed-position accent arc,
white icon instead of a coloured one, coloured dot) verified via computed-style/DOM assertions rather
than raw pixels, since the local sandbox's home screen renders on a plain white background (the
dynamic-background gradient art doesn't load there) which makes the white icon/number text
indistinguishable from the page in a screenshot — a pre-existing sandbox limitation, not a regression,
and already covered by the device-gated caveat below; (2) flipping `ta_score_ring_style` via
localStorage correctly switches size/shape across all four; (3) the vertical-list "Score Card Style"
picker in More → Home Widgets now renders all four rows with the correct one checkmarked; (4) a real
click on the "Accent ring" list row moved the selection and confirmed the stored localStorage value
updated to `"accentring"` — the full read/write round-trip, not just the render.

**Not verified (device-gated, unchanged):** Samsung-WebView paint of all four ring styles against the
real blue-gradient home background; real ring-data scores. No scoring/formula changes this round, so
the W-B/W-C/W-D verification status from prior rounds is unaffected.

---

### Round 5 — a fifth style: Halo

Asked to brainstorm further, six entirely new frame concepts were mocked up (gradient sweep, plate-rim
dashes, double hairline, soft halo, compass ticks, no frame at all) — the owner rejected five outright
("pretty bad") and rated the sixth, **soft halo**, as only "average." Given the choice between stopping
at four, adding halo anyway, or another blind mockup round, the owner chose to add it — an "average"
rating was still worth having as a selectable option, not worth iterating further on blind.

**Halo** drops the stroke/frame entirely: a soft blurred radial glow in the card's identity colour sits
behind the icon and number instead of any ring (`HaloFrame` in `components/oura-score-chip-row.tsx` — a
CSS `radial-gradient` + `blur(16px)` div, not an SVG frame like the other four styles). It shares the
114px size with default/open-ring. Added as `"halo"` to `ScoreRingStyle` in `lib/home/home-prefs.ts` —
now five values (`default` | `openring` | `perforated` | `accentring` | `halo`), with a matching fifth
row in the "Score Card Style" list (no picker-UI changes needed — it's a generic `.map()` over
`SCORE_RING_STYLES`).

**Verification:** `tsc` clean, lint clean, full suite still **1952 passing**. Dev-server + Playwright
confirmed: the glow renders with the correct per-card colour and blur (`radial-gradient(circle,
<accent> 0%, transparent 68%)`, `filter: blur(16px)`) via computed-style assertions; unlike the other
four styles' white text (invisible against the sandbox's flat white background — see above), halo's
coloured glow gives the white number enough contrast to read clearly even in the sandbox screenshot, a
useful practical confirmation; the settings list now shows all **five** rows; a real click on the
"Halo" row moved the selection and confirmed `localStorage` updated to `"halo"`.
