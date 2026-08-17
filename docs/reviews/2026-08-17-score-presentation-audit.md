# Q-281 — every surface that renders a pillar score, audited

**Date:** 2026-08-17 · **Lane:** Implementation B · **Scope:** the audit half of Q-281 only

Q-281's own sequencing says to do the audit now — it is cheap and its output is durable — and to
**hold the UI work** until Q-500 / Q-272 / Q-275 / Q-277 settle the numbers, or it gets done twice.
This is that audit. No UI changed.

The convention Q-281 measures against: no incumbent (Garmin, Whoop, Oura) ships a bare 0–100 with no
contributors, no trend and no "so what".

---

## 1. The surfaces

Every site rendering one of the five pillars (Readiness · Sleep · Activity · Daytime stress ·
Resilience), plus the two non-pillar scores that share `scoreBand()`. **C** = contributors,
**T** = trend, **A** = an action or interpretation.

| # | Surface | Pillars | C | T | A | Band colour used? |
|---|---|---|---|---|---|---|
| 1 | `components/oura-score-chip-row.tsx` — Home | Readiness · Sleep · Activity (+HR) | ✗ | ✗ | tap → detail | **1 of 20 styles only** ⚠️ |
| 2 | `components/health/health-score-detail.tsx` — `/health/{readiness,sleep,activity}` | one, per route | ✓ | ✓ | AI insight | ✓ with label |
| 3 | `components/health/readiness-breakdown.tsx` | Readiness | ✓ | ✗ | tap → deep-dive | ✓, label from #2 above it |
| 4 | `components/health/contributor-chart.tsx` `FactorBar` | contributor sub-scores | — | ✗ | tap → detail | ✓ **no band word** ⚠️ |
| 5 | `components/health/contributor-details.tsx` | contributor sub-scores | — | ✗ | guide: how to move it | ✓ with label |
| 6 | `components/health/resilience-tile.tsx` | Resilience | ✗ | ✗ | ✗ | ✗ — icon + word, no colour |
| 7 | `app/health/day/day-detail-content.tsx` `ScoreCell` | Readiness · Sleep · Activity (+HR), any day | ✗ | ✗ | ✗ | ✗ — identity colour only |
| 8 | `components/home-day-timeline.tsx` | Readiness · Sleep | ✗ | ✗ | ✗ | ✗ — fixed icon colours |
| 9 | `components/health/day-detail/day-sections.tsx` | Sleep | hypnogram below | ✗ | ✗ | ✗ — identity colour |
| 10 | `components/health/body-cards/sleep-card.tsx` | Sleep | stage chips | ✗ | tap → sheet | ✗ — identity colour |
| 11 | `app/health/activity/activity-content.tsx` stress tiles | Daytime stress | ✗ | ✗ | ✗ | ✗ — minutes, not a score |
| 12 | `app/health/health-sections.tsx` `hrvBaseline` | *(HRV deviation)* | — | ✗ | explainer | ✓ with label |
| 13 | `app/session-explain/components/score-ring.tsx` | *(session fit)* | via sibling cards | ✗ | the explanation itself | ✓ with label |
| 14 | `app/session-explain/components/alternatives-card.tsx` | *(session fit)* | — | ✗ | pick an alternative | ✓ with label |

**Nine of fourteen render a score with no contributors and no trend.** Exactly one surface (#2) has
all three, and it is the one a user reaches only by tapping through from Home.

---

## 2. The colour-only-state check — 2 candidates, only 1 of them real

`CLAUDE.md`: *"`scoreBand()` colour always ships paired with `scoreBand()`'s label/icon — colouring a
value by band without rendering the band's text is the colour-only-state violation."*

**#1, `accentring` style — a real violation.** `scoreCue()` returns the band colour and word;
`RING_GEOMETRY` gives `showDot: true` to `accentring` alone, which renders

```tsx
{geo.showDot && props.cue && <span className="…rounded-full" style={{ background: props.cue.color }} aria-hidden />}
```

An 8 px dot, `aria-hidden`, carrying the band and nothing else. The word reaches the aria-label, so a
screen reader gets it — but a sighted user with a red/green deficit gets no band at all. The other
nineteen styles drop the dot and render **no** state colour, which is not a violation; it is the
absence of the cue entirely. So the finding is narrower than "the Home row violates the rule": it is
one of twenty selectable styles, and the fix is a word rather than a dot.

**#4, `FactorBar` — a literal match, and I do not think it should be treated as one.** The bar fill
and the trailing number are both `scoreBand(val).color`, and no band word is rendered. But the
trailing number *is* the sub-score, in text, next to the bar — the state is redundantly encoded in a
non-colour channel, which is what the rule is protecting. Adding "High/Moderate/Low" to each of 5–7
rows would crowd the densest surface in the app for no information gain. **Recorded as inspected and
deliberately not filed.** If it is ever changed, the reason should be crowding or clarity, not this
rule.

**#3's "Final readiness" row** colours the number without a word, but sits directly under #2's hero,
which renders the band label for the same number. On screen together; not a violation.

---

## 3. Three findings the entry did not anticipate

**(a) `packages/shared/src/health/score-audit/` has no user-facing consumer.** Q-281 says *"the
machinery already exists and is good… Some surfaces use it; the question is which do not."* For
`readinessCompositeContributors` and `scoreBand()` that is true. For the score-audit layer it is not:
its only importers are `app/api/admin/backfill-derived-scores`, `app/api/admin/day-review`,
`components/admin/day-review-tab.tsx` and `packages/shared/src/health/activity-score.ts` — two admin
routes, one admin tab, and one producer. **Zero user-facing surfaces.** Any plan that plans to "wire
up the existing layer" is building a first consumer, not connecting a second.

**(b) `scoreAvailability` has exactly one consumer**, `components/health/readiness-breakdown.tsx`.
Q-278 already says it is readiness-only; the audit adds that it is also *one-surface*-only, so
generalising it (Q-278 scope item 1) has a single migration site rather than a sweep.

**(c) Daytime stress has no score surface at all.** Q-278 counts it as a pillar at 55% coverage. In
the UI it appears only as two "Stress / Recovery" **minute** tiles inside `/health/activity`, both
hidden unless both values are non-null. There is no daytime-stress card, chip, trend or detail route.
Resilience is nearly as thin — one tile, inside `/health/readiness` only, and only when
`ownResilienceLevel` and `ownResilienceBand` are both present.

So the five pillars are not five peers: **three have a detail route, one has two nested tiles, one
has a single conditional tile.**

---

## 4. Absent vs zero — better than Q-278 assumed, on the surfaces that were checked

Q-278 says a day with no score renders *"typically a gap, a carried-forward value, or nothing,
depending on the surface. There is no single answer because there is no single contract."* That is
true about the *contract*, but every surface audited here independently arrived at the same
behaviour, and it is the right one:

- #1 Home and #7 day-detail render **`—`** (`value ?? "—"`), not a zero and not a carried value.
- #2's `ScoreDisplay` renders `—` with a muted ring and **suppresses the band label**, so a null
  score cannot borrow "Low".
- #8, #9, #10, #11 **hide the element entirely** on null (`{x != null && …}`).
- #6 renders only when both level and band are present.

**No surface renders a null score as 0, and none carries yesterday's value forward.** What is missing
is the *why* — nothing says "the ring wasn't worn" or "not enough days yet" — which is Q-278's actual
scope. The pre-existing qualifiers (`lowWear`, `limited`, `provisional`) are the closest thing and
cover only readiness.

This narrows Q-278: it is not a defect sweep across surfaces, it is one missing explanation layer
behind an already-consistent em-dash.

---

## 5. What this recommends for the UI half

Held, per the entry's sequencing. When it is taken up:

1. **The band word on `accentring`'s dot** is the only colour-only-state fix, and it is independent
   of every score-model change — the label/colour pairing does not move when the numbers are
   recalibrated. It could ship early without being done twice.
2. **Trend is the missing dimension, not contributors.** Only #2 shows one. Contributors are
   genuinely inapplicable to a chip or a timeline row; a 7-day sparkline is not.
3. **Do not start from "wire up score-audit"** — see 3(a).
4. **Decide whether stress and resilience are pillars.** If they are, they need a surface; if they
   are not, Q-278's five-pillar coverage table is measuring three pillars and two derived values.

## What was NOT exercised

- **Nothing ran.** This is a source audit at a point in time (`main`, 2026-08-17). It reports what
  the code renders, not what a device shows.
- **Contrast was not measured** for any of the band colours, on either theme. That gap is Q-282's.
- **The AI Coach's prose** is listed in Q-281's scope and is *not* in the table: it emits sentences,
  not score elements, so "does it show contributors" has no answer for it. Its separate defect — the
  literal `"no data"` read as zero — is already Q-353.
