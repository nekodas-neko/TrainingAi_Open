# 2026-08-09 — "recommended emergency deload but wouldn't tell me why" (Q-173)

**Branch:** `feat/deload-card-reason` · **Domain:** `readiness`, `app-shell` · **v1.277.0**

## What was missing

`EarlyDeloadCard` fires on a two-number check in `readiness-payload.ts`:
`score < 45 && acwr > 1.2`. The card's copy was fixed text — *"Your readiness is low and training
load is elevated"* — with no numbers, no thresholds, and no way to expand. Neither raw value even
reached the client: `ReadinessScoreResponse` carried the boolean and nothing else.

The sibling feature already solved this. `DeloadExplanation`, on the day-to-day recommendation
card, is a "Why this recommendation?" collapsible listing each signal in plain English with its
actual number and threshold. The drastic recommendation — a whole deload *week* — had no equivalent.

## What shipped

`ReadinessScoreResponse` gains `earlyDeload: { score, acwr, scoreThreshold, acwrThreshold } | null`,
populated only inside the branch that sets the flag, so the card can never render a reason for a
recommendation that isn't being made.

The card gains a collapsible in `DeloadExplanation`'s visual language — not the same component, on
purpose: that one explains a day-scoped signal set (temperature, HRV trend, sore muscles), this one
explains a threshold check. Same pattern, different data.

> Readiness **38** — under 45, the point where recovery is not keeping up with what you are asking of it.
> Training load **1.47** — above 1.20. That is this week's load against your four-week average, so you are doing meaningfully more than your body is used to.

Plus an "Your options" block saying what each button does — including that dismissing changes
nothing and the card returns tomorrow if both signals still hold.

**The thresholds travel in the payload rather than being duplicated in the card.** A card with its
own copy of `45` can drift into stating a bound the server no longer applies, which is worse than
saying nothing. A test asserts the card contains neither literal.

## The 1.2 that looks like a typo and isn't

`ACWR_THRESHOLDS.optimalMax` is **1.3**. The early-deload check uses **1.2** — it fires while load
is still inside the optimal band, because it is paired with a readiness score under 45. The pair is
the signal, not either number alone.

Both bounds were bare literals. They are now `EARLY_DELOAD_SCORE_MAX` / `EARLY_DELOAD_ACWR_MIN`
with that reasoning attached, and a test pins `EARLY_DELOAD_ACWR_MIN < ACWR_THRESHOLDS.optimalMax`
— a future tidy-up that "unifies" them would silently change who sees the card.

## Verified

- `tsc --noEmit` clean · **431 files / 3434 tests** green · all 15 custom-rule scripts pass · eslint
  clean (6 warnings in the touched files are pre-existing on `main`, confirmed by stashing).
- `GET /api/readiness-score` returns the new key (`earlyDeload: null` in the seeded state, which is
  correct — the flag is false).
- The card rendered on the Home tab with the section expanded: trigger present,
  `aria-expanded` flips to `"true"`, and the text reads *"Readiness 38 — under 45…"* /
  *"Training load 1.47 — above 1.20…"* with the options block. No page errors.

**How that render was reached, since it matters:** the seeded DB cannot get there — `acwr` is
`null`, because the nine seeded workouts all predate the acute window, and manufacturing months of
physiology to see one card was the wrong trade. `window.fetch` was patched in-page to flip the two
fields on the real response, so the real card rendered from the real payload shape. Playwright's
`page.route` was tried first and deadlocked: the service worker intercepts every `/api/` request,
and re-fetching through it from a route handler hangs. Worth knowing for the next UI check.

The screenshot is unusable — the morning check-in sheet auto-opens over Home and covered the card.
The DOM assertions above are the evidence, not an image.

## Not exercised

- **The APK.** The collapsible is Radix (`aria-expanded` comes free, so this adds no tenth
  hand-rolled chevron toggle), but nothing here was seen on the S25.
- **The real trigger.** Every number above came from a patched response. The *path* from a genuine
  `score < 45 && acwr > 1.2` to a rendered card is unproven end-to-end — the payload half is
  covered by tests, the render half by the patched run, and the join between them by neither.
