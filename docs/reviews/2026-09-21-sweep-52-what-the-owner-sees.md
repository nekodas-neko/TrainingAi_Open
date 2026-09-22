# Review sweep 52 — what the owner actually sees

**Date:** 2026-09-21 · **Scope:** whole app, four visual lenses chosen by this session — number/unit
formatting drift, 384px layout integrity, empty/zero/error states, colour semantics and contrast.
**Method:** four read-only lanes, **every load-bearing claim re-verified at source or against
production by the coordinator before filing.** Nothing was rendered: no device, no WebView, no
screenshots. Every "what the owner sees" below is computed from the quoted expression and the
measured content, and is stated as such.

**Findings are ranked by where the owner actually is.** From the resume telemetry in `error_events`:
**Home 22 · Nutrition 14 · Health 11 · More 7 · Workout 2.** A drift on Home outranks a tidier fix
on a settings sub-page, and that ordering is evidence rather than taste.

## The systemic one: `cachedFetch` cannot reject, so 16 error states are unreachable

`cachedFetchCore`'s entire network section is inside `try { … } catch { … } finally { … }`
(`lib/sqlite/cache.ts:336-372`). A `!res.ok` returns after calling `onError`; a network throw is
caught. **The promise resolves a boolean and can never reject.** So every `.catch()` chained onto a
`cachedFetch` is dead code — **16 sites**. Confirmed consequences: Coach's option picker sits on
*"Loading your options…"* forever because `choice-list.tsx:63`'s `.catch(() => setFailed(true))`
never runs, and the Profile achievements grid spins forever for the same reason
(`profile-tab.tsx:122`).

This is one rule with a one-line test — a `.catch(` chained directly onto `cachedFetch(` is *always*
wrong — which makes it a check script rather than a sweep that has to be repeated.

## Home, the most-used screen, has three failure-vanish bugs

**The whole score row disappears.** `{readiness && <OuraScoreChipRow …>}`
(`session-select-content.tsx:1128`) also gates the illness advisory and the early-deload banner. If
`/api/readiness-score` fails there is no row, no skeleton and no message. The helper behind it is
the part worth reading: `fetchWithRetry`'s own header says it exists so a blip doesn't leave *"the
readiness/sleep widgets blank until the app is restarted"* — and it retries three times, then gives
up **silently**, via `.catch(() => {})` and a `void` return with no error channel at all. It solves
the transient case and quietly accepts the persistent one, landing on exactly the blank widget it
was written to prevent.

**A failed streak fetch paints a confident zero.** `setCalendarDays` runs only on success
(`:538-543`), so `streak` computes from `{}` and `StreakCard` renders **0-day streak, 0 sessions
this week** as fact. Absence rendered as zero, on the most alarming number the screen can show.

**Profile invents a whole lifetime.** Every stat is `?? 0` (`profile-tab.tsx:175-190`), so a failed
`/api/achievements` reads *Level 1 · Novice · 0 XP*, all-zero lifetime stats including best streak,
and "0 / 0" achievements — while the grid underneath spins forever.

**The app already owns the right patterns.** `observed-hr-card.tsx` distinguishes measured from
missing with "—" and discloses when a max is age-estimated; `oura-section.tsx:70-76` passes
`onError` and renders a real failure state; `nutrition-activity-trends-card.tsx:22-39` carries an
explicit comment that `cachedFetch` never rejects and handles it. These are not missing ideas. They
are unevenly applied.

## One stored 1RM renders four different numbers

The value is stored on a 0.25 grid (`1rm.ts:81`). For a stored **92.25**, in a single session:

| Surface | Expression | Renders |
|---|---|---|
| Ready screen | `mround125(...)` | **92.5 kg** |
| Exercise summary | raw | **92.25 kg** |
| Pre-workout list | `Math.round(...)` | **~92kg** |
| Health › Strength trend | `.toFixed(1)` | **92.3 kg** |
| Exercise stats sheet | `.toFixed(1)` | **92.3 kg** |

Four numbers and three unit spacings for one quantity. The sharpest detail: **four of these call the
shared `displayOneRm` helper for the bodyweight branch of the same ternary and hand-roll the
weighted branch.** The helper is right there, half-used.

And `mround125` is a **prescription** rounder — a barbell plate grid, clamped 5–250
(`workout/utils.ts:47`). Using it for display has already caused a live bug: `projectOverview.md`
records BF-127, where the baseline banner told the owner to load **82.5 kg on a pull-up** because
`mround125` was applied to a bodyweight 1RM index. Display duty is not its job.

Same class, lower down: body weight renders raw on Home and Health, `.toFixed(1)` on Profile and day
detail, and `82.45kg` with no space in the week-day sheet — **seven sites, no shared formatter
exists**. Pace has a shared `formatPace` used at two sites and hand-rolled at seven more in two unit
spellings. Activity duration is `42.4 min` on the done screen and `42 min` when reopened from
history. And `kcal` appears **154 times against a single `Cal`** at `home-day-timeline.tsx:117`.

## Layout: a real CSS bug, and truncation measured against real content

**`truncate` on a flex container does nothing.** `pre-workout-screen.tsx:354` is
`<p className="font-medium truncate flex items-center gap-2">`. `text-overflow` applies to inline
content of a *block* container; on a flex container the text becomes an anonymous flex item that
never shrinks. **So the name hard-clips with no ellipsis** — and the green "done today" tick, which
sits after the name, is clipped out of existence, so a completed exercise reads as unlogged. It is
the only such site in non-admin code; the other 17 `truncate` uses are correctly on flex *items*.

**The injury chip is live and it eats the title.** `claude_ro.injuries` holds one unresolved row —
`lower back`, unresolved since 2026-01-01 — so this renders for real. The chip is `shrink-0` with
`max-w-[11rem]`, taking **176 of 352px** unconditionally, leaving the exercise title ~168px ≈ **15
characters** at `text-xl font-bold`. Mid-set, "Single Leg Romanian Deadlift" reads
`Single Leg Roma…` while half the header repeats a warning already shown on the ready screen.

**Food names are the Nutrition tab's worst case, and Nutrition is the #2 screen.** The diary row
gives the name **162px ≈ 22 characters**. Production: **337 food items, 130 longer than 22
characters, 76 longer than 30, longest 66.** And there is a real collision — "Up & Go Protein
Energize Choc Hit" and "Up & Go Protein Energize" both render as `Up & Go Protein Energi…`, two
identical-looking rows with different calories.

## Colour: a number painted the wrong band's colour

`training-load-card.tsx:71` renders the ACWR value with a hard-coded `style={{ color: '#f59e0b' }}`
— which is precisely the colour `acwrBand()` reserves for the **"High"** band (`acwr.ts:77`), while
`optimal` is `#22c55e`. The band *word* beside it comes from the real interpretation. So an ACWR of
1.05 shows **"✓ Optimal zone" with the number in warning amber**, above a line of body copy saying
the green zone is 0.8–1.3. `acwrBandByKey()` exists at `acwr.ts:90` for exactly this caller and is
not imported.

**"Deload" is green on one screen and red on another.** `ai-periodization-status-card.tsx:41` has
`deload: "text-green-500"`; `deload-banner.tsx:21-26` paints the same concept `#ef4444` / `#f97316`
/ `#fbbf24` by strength. Glance at the phase card and green reads "all good"; glance at the banner
and it reads "act now". Neither is wrong alone and the pair cannot both be right. In the same file
`realisation` — the peak phase — is `text-red-500`, the app's failure colour everywhere else.

**Good/warning/bad exists as two parallel palettes.** A raw-hex triad (`score-band.ts`:
`#22c55e`/`#f59e0b`/`#ef4444`) and a token triad (`recovery-band.ts`, `body-battery-band.ts`:
`var(--accent-green)`/`var(--accent-amber)`/`var(--destructive)`). Resolved in dark these are
genuinely different colours, not shades: green `rgb(34,197,94)` vs `rgb(86,238,102)`. The hex triad
is copy-pasted — **173 occurrences across ~25 files** — so only one half of the app can follow the
theme.

**Contrast has a real hole with a real consequence.** `scripts/check-contrast.js` validates ten bare
token pairs and has no opacity handling, so `text-muted-foreground/60` and below are unguarded.
Measured over `--card`: `/60` = **3.73:1**, `/50` = **2.97:1**, `/40` = **2.34:1** (AA needs 4.5:1
for body text). The one that matters: `calendar-widget.tsx:187` renders the word "rest" at **7px,
`/50`, 2.97:1** — and that label is the *only* thing distinguishing a past rest day from a past
untracked day in the month grid.

## Clean — verified, do not re-sweep

Steps are `toLocaleString()` at all eight sites; `bpm` is lowercase at all 165. `scoreBand()` is
genuinely one place and its consumers ship the word with the colour (the ACWR card is the one
exception). Touch targets are floored to 48px globally by `globals.css:582`. The segmented tabs,
activity grid, walk summary and sets grid all fit 384px with the real longest content. 1RM *deltas*
agree across all three sites. Core dark pairs are comfortable: foreground on card 17.78:1,
muted-foreground 8.36:1. `resolveColor()` correctly handles the canvas-cannot-read-`var()` trap.
`SESSION_PALETTE` is properly categorical and the calendar renders a real legend for it.

## Not established

- **Nothing was rendered.** No device, no WebView, no `pnpm dev`, no screenshot. Widths are computed
  from classNames plus Inter advance-ratio estimates (±10% moves the marginal cases); contrast
  ratios are computed from resolved tokens. **No layout break and no colour was observed.**
- **Contrast composites assume an opaque `--card`.** Several screens render wallpaper gradients
  under semi-transparent cards; that layer was not modelled, so those ratios could move either way.
- **OS font-scale is unaccounted for** — a larger system font makes every layout finding worse, and
  whether the WebView honours it was not checked.
- `claude_ro` is **the owner's rows only**, so 337 food items and the single injury are his data.
- Macro grams, water, sleep-stage durations and HRV were not swept; the formatting lane stopped at
  six findings. Chart axis/tooltip callbacks were spot-checked, not swept.
- Whether both surfaces of the deload colour collision are reachable in one session was not
  established.
