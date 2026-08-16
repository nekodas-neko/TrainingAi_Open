# 2026-08-07 — Workout screen: "Other Activity" becomes the Cardio Hub card

**Branch:** `claude/health-metrics-button-designs-hy6cyv` · **Version:** 1.269.0

## What this was

The owner said the workout screen's Other Activity row "could have more impact". Fourteen mockups
(`docs/design/2026-08-07-other-activity-mockups.html`), then a full-screen comparison of the two
finalists (`docs/design/2026-08-07-cardio-hub-fullscreen.html`). **B2 was picked**, with a rename to
Cardio Hub.

## The finding that drove the design

The row is not a minor control — it is the entry point to `/cardio`, behind which sit the running
plan (with a prescription for *today*), the weekly zone-minute quota, the steps quota, the heart
profile and the trends section. It displayed none of that, while the card directly above it shows
five exercises, a duration, a muscle map and four recovery percentages. It was also nearly
full-bleed while the card is inset 16dp, so the two never read as related.

## What shipped

`app/workout-select/workout-select-content.tsx` — the row is now a card: `mx-4` and `rounded-2xl` to
match the workout card exactly, tinted with `--accent-cyan` through the `color-mix(in oklch, …)`
pattern the cardio domain already uses (`modality-picker.tsx` is the reference), an icon tile, the
title, and a subtitle naming the three destinations. `components/cardio/cardio-content.tsx` — the
destination heading changes `Cardiovascular` → `Cardio Hub`.

## Decisions worth not re-litigating

- **The extra height is safe by construction, not by tuning.** The card container is
  `flex-1 min-h-0`, so a taller row cannot overflow the screen — it shrinks the card. Inside the
  card the muscle diagram is also `flex-1` and is the only element that gives way; the session
  header, recovery chips and Start button are all `flex-none`. Measured against the running dev
  server: row 380×72dp at 16/16 insets, workout card 594dp.
- **The rename covers both surfaces.** Tapping "Cardio Hub" and landing on a screen headed
  "Cardiovascular" reads as having gone somewhere unintended. The two must move together.
- **"Other activity" inside the hub keeps its name.** `modality-picker.tsx` and
  `time-picker-sheet.tsx` use it for the log-anything modality (treadmill, cycle, anything logged),
  which is a genuinely different thing from the hub itself. Deliberately not renamed.
- **No new data on the row.** Several mockups (A1–A4) showed the scheduled run, the zone-minute
  deficit or today's state. All were rejected in favour of B2 — and they would each have added a
  network dependency to a screen that currently paints instantly from the workout cache. If one is
  ever revisited it needs its own cache seed, or the row flashes empty on every visit.

## Verification

Signed in as the seeded user against the local dev server and loaded the real screen at 412×891:
the card renders, aligns with the workout card, and tapping it navigates to `/cardio` with the
heading reading "Cardio Hub". No page errors.

**Not verified on device.** Nothing here uses blur, filter or backdrop-filter, and the row is not
bottom-anchored (it sits above the nav), so neither the Samsung compositor bug nor the safe-area
floor is in play. The unexercised surface is Samsung WebView rendering of the `color-mix` gradient.

## Found while verifying — not fixed

The **RECOVERY chip strip on the workout card is clipped at both ends** — it reproduced exactly in
the local dev render, not just in the owner's screenshot, so this is a real bug rather than a
device artefact. See the Known-Issues row in `projectOverview.md`.
