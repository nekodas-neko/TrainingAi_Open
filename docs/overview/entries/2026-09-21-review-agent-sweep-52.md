# Review sweep 52 — what the owner actually sees

**Branch:** `review/sweep-52-visual` · docs-only · Review Agent.
**Write-up:** [`docs/reviews/2026-09-21-sweep-52-what-the-owner-sees.md`](../../reviews/2026-09-21-sweep-52-what-the-owner-sees.md).
**Filed:** RV-84 … RV-102 (19 entries, two new batches).

The owner asked for another review on this line, angles of my own choosing, weighted toward things
that visually affect him. Four read-only lanes — number/unit formatting drift, 384px layout
integrity, empty/zero/error states, colour semantics and contrast — with every load-bearing claim
re-verified at source or against production before filing.

**Findings are ranked by where the owner actually is.** The resume telemetry in `error_events` gives
**Home 22 · Nutrition 14 · Health 11 · More 7 · Workout 2**, so a drift on Home outranks a tidier
fix elsewhere by evidence rather than taste. That ordering is worth reusing.

## The systemic finding

`cachedFetch` **cannot reject** — its network section is wrapped in `try/catch/finally`, so a 500, a
429 and an offline throw all resolve a boolean. Every `.catch()` chained onto it is dead code, at
**16 sites**, and the error states built on them are unreachable: Coach's option picker sits on
"Loading your options…" forever, the Profile achievements grid spins forever. One rule, one-line
test, so RV-84 asks for a check script rather than a sweep that has to be repeated.

## Home carries three failure-vanish bugs

The score row disappears entirely on a failed fetch — no row, no skeleton, no message (RV-85). A
failed streak fetch paints a confident **0-day streak, 0 sessions this week** (RV-86). Profile
invents *Level 1 · Novice · 0 XP* and all-zero lifetime stats (RV-87).

RV-85 is the one worth reading: `fetchWithRetry`'s own header says it exists so a blip doesn't leave
"the readiness/sleep widgets blank until the app is restarted" — and it retries three times, then
gives up silently through `.catch(() => {})` and a `void` return with no error channel. It fixes the
transient case, quietly accepts the persistent one, and lands on exactly the blank widget it was
written to prevent.

**The app already owns the right patterns** — `observed-hr-card.tsx` for measured-vs-missing,
`oura-section.tsx` for `onError`, `nutrition-activity-trends-card.tsx` which even carries a comment
explaining that `cachedFetch` never rejects. These are unevenly applied, not absent.

## One stored 1RM renders four different numbers

For a stored 92.25: **92.5** (ready screen) · **92.25** (summary) · **~92** (pre-workout) ·
**92.3** (strength trend, stats sheet). Four numbers, three unit spacings. Four of the five sites
call the shared `displayOneRm` for the *bodyweight* branch of the same ternary and hand-roll the
weighted branch — the helper is imported and half-used (RV-89).

`mround125` doing display duty is the sharp edge: it is a barbell-plate rounder, and
`projectOverview.md` records **BF-127**, where applying it to a bodyweight 1RM index told the owner
to load 82.5 kg on a pull-up. Same class, lower down: body weight renders five ways across seven
sites with no shared formatter (RV-90), and `kcal` appears 154 times against a single `Cal` (RV-91).

## Layout: a real CSS bug, measured against real content

`pre-workout-screen.tsx:354` puts `truncate` on a **flex container**, where `text-overflow` cannot
apply — so the name hard-clips with no ellipsis *and* the green "done today" tick is clipped out of
existence, making a completed exercise read as unlogged (RV-92). It is the only such site in
non-admin code; the other 17 are correctly on flex items.

The rest are measured against production, not invented worst cases: the injury chip is `shrink-0` at
176 of 352px and the owner has a **live unresolved lower-back injury**, squeezing the mid-set title
to ~15 characters (RV-93); the food diary gives a name 22 characters while **130 of 337 real items
are longer**, with a genuine collision between two "Up & Go Protein Energi…" rows (RV-94); the
weekly Volume tile wraps for every non-zero week (RV-95).

## Colour: a number painted the wrong band's colour

`training-load-card.tsx:71` hard-codes `#f59e0b` for the ACWR value — exactly what `acwrBand()`
reserves for **"High"** — while the word beside it comes from the real interpretation. An ACWR of
1.05 shows "✓ Optimal zone" in warning amber, above copy saying the green zone is 0.8–1.3.
`acwrBandByKey()` exists for that caller and is not imported (RV-97).

"Deload" is green on the phase card and red/orange/amber on the banner (RV-100). Good/warning/bad
exists as two parallel palettes — a raw-hex triad copy-pasted **173 times** and a token triad — so
only half the app can follow the theme (RV-99). And `scripts/check-contrast.js` has no opacity
handling, so `/60` and below are unguarded: the calendar's 7px "rest" marker sits at **2.97:1**, and
it is the only thing distinguishing a past rest day from an untracked one (RV-98).

## Clean, verified

Steps and `bpm` are uniform everywhere. `scoreBand()` is genuinely one place and its consumers ship
the word with the colour — the ACWR card is the single exception. Touch targets are floored to 48px
globally. Segmented tabs, the activity grid, walk summary and sets grid all fit 384px with real
content. 1RM deltas agree across all three sites. Core dark pairs are comfortable (foreground on
card 17.78:1).

## Not established

**Nothing was rendered** — no device, no WebView, no screenshot. Widths are computed from classNames
plus font advance-ratio estimates (±10% moves the marginal cases); contrast is computed from
resolved tokens. No layout break and no colour was observed. Contrast composites assume an opaque
`--card`, and several screens render wallpaper gradients under semi-transparent cards — that layer
was not modelled. OS font-scale is unaccounted for and makes every layout finding worse. `claude_ro`
is the owner's rows only. Macro grams, water, sleep-stage durations and HRV were not swept.
