# 2026-08-25 — Q-112 re-planned: the read-through it wanted was built two days after it was filed

**Branch:** `docs/unified-day-review-plan` · **Lane B** · **docs-only**, no code, no version bump.

## What this is

Q-112 is the owner's ask to merge Home's "Your Day in Review" with Nutrition's "End of Day" into
one richer daily review. Its own entry said *"whoever picks this up should write a proper
implementation plan first"*, and none existed. This is that plan:
[`docs/superpowers/plans/2026-08-25-unified-day-review.md`](../../superpowers/plans/2026-08-25-unified-day-review.md),
with the queue entry replaced by an umbrella plus **Q-112a–e**, each one PR with its own lane,
branch and `Needs:`.

## The finding that changed the plan

**Task 27's central premise stopped being true two days after it was written.** It asked for a new
merged day screen on the grounds that no per-day read-through existed. **Q-110 shipped `/health/day`
on 2026-08-08.** Reading the files rather than the entry, that screen already draws:

- the full body-composition list the entry asks for — weight plus 14 rows including skeletal muscle,
  visceral fat, BMR, metabolic age, fat-free mass, RHR, HRV and SpO₂;
- energy in and out, with a through-the-day timeline chart;
- per-session volume, duration and estimated kcal, grouped by session **id**;
- steps and distance, the four daily scores, sleep, and a day HR trace;
- swipe-between-days, the interaction the entry wanted converged on.

Of the entry's requested stats, three are genuinely missing (HR min/max as a stat, body temperature,
the AI digest), one is missing everywhere (the 7-day lookback), and the wrap-up steps live in a
disconnected sheet. **Building the screen as written would have made a third day surface and
re-implemented seven working sections** — the outcome "One Formula, One Place" exists to prevent,
arriving through duplicated assembly rather than duplicated arithmetic.

So the plan reframes it: **`/health/day` is the read-through, and the evening review is a flow.**
What makes that cheap is that `components/health/day-detail/day-sections.tsx` already exports its
six sections as standalone `memo` components fed from the `day-log:<date>` cache key — they render
inside the evening sheet unchanged, and the shared key means opening one paints from what the other
already fetched.

## A second open decision that was already answered

Task 27 lists "banner vs. notification" as undecided. **Both shipped.** `lib/day-review-reminders.ts`
schedules a local notification 50 minutes before estimated bedtime — *"Begin your wind-down and
complete your end-of-day review"* — plus a Sunday-18:00 weekly one, and Home carries an
hour-gated banner. The real gap is one string: both notifications set `extra: { route: '/' }`, and
the tap handler pushes exactly that, so the reminder lands the user on Home and asks them to find
the banner. The plan keeps both and makes them the same door — the notification is the only one that
reaches a closed app, the banner the only one that serves an already-open one.

## Decisions taken rather than deferred

- **A stepped sheet, not a footer on `/health/day`.** The footer is fewer hops and closer to the
  owner's mental model, and it loses on that screen's own terms: `/health/day` browses any date and
  swipes between them, while the evening flow is today-only, so the control would appear and vanish
  mid-swipe. Named in the plan as the alternative worth revisiting from use.
- **One skip rule for every step**, rather than per-section logic: a step is a prompt when it has an
  unanswered question, a summary when it does not, and omitted when it has neither.
- **Four stats get a trend, not fourteen** — resting HR, steps, session volume, weight. Composition
  percentages move too slowly for a 7-day sparkline to read as anything but noise, and a delta beside
  a `scoreBand()` word is two answers to one question. Stated as a recommendation to overrule.

## Not done

No code. No owner question was raised, because none of the deferred decisions turned out to need
one: two were already settled by shipped work and the rest are cheap to reverse. The device-gated
parts (notification deep-linking, sheet insets, the swipe) are named in the plan as unprovable in
the web harness.

**A backlog baseline raise was prepared and withdrawn** — moving the reasoning into the plan cut the
queue growth from ~60 lines to 19, and `main` had shrunk the file enough that 19 fitted inside the
existing headroom.
