# 2026-09-01 — BF-82: the More page is two groups, not nine

**Branch:** `feat/bf-82-more-page-grouping` · **Domain:** `app-shell` · **Lane:** B · **Version:** v1.419.0

Built §3 and §4 of [`docs/superpowers/plans/2026-08-31-more-page-grouping-and-interaction-model.md`](../../superpowers/plans/2026-08-31-more-page-grouping-and-interaction-model.md).

## What was wrong

`MoreRowGroup` is an uppercase 10px heading plus a bordered container. The app had **nine** of them
wrapping exactly one `MoreRow` — seven on the More tab (Profile, Program, Health, Devices, Settings,
Data, About, Admin — Profile arrived with BF-79), one on the Settings sub-screen (`Developer`), and
one hand-written copy in `feedback-section.tsx` that re-implemented the primitive's markup rather
than importing it. Three stacked elements to present one tappable line, nine times over. That is
most of why the screen read as long and empty at the same time.

`goals-section.tsx` was a tenth copy of the same markup — heading and shell hand-written, with an
inline disclosure inside — which is what made an expanding card look like the navigating rows below it.

## What shipped

- **Seven headings → two.** `Your setup` (Profile details · Program · DEXA & RMR · Devices) and
  `App` (Settings · Data & Sync · About · Admin, the last `isAdmin`-gated). Admin sits inside `App`
  rather than keeping its own heading — that is how it became a single-row group in the first place.
- **`MoreRowGroup`'s `label` is now optional.** Omitting it renders the card with no heading, which
  is the supported way to draw one row. `DeveloperSettingsGroup` uses it; it stays a separate card
  because it is admin-only and folding it into the settings block would leave a visibly short card
  for everyone else.
- **`FeedbackSection` is a bottom action**, beside Edit Profile and Sign Out. It opens a sheet rather
  than navigating, so it was never a destination; it is now a ghost button and no longer copies
  `MoreRowGroup`'s markup.
- **`GoalsSection` lost the copied heading** and presents as a card like `StatsGrid` and `TrophyCase`
  directly above it. The bordered shell stays — without it Goals is a bare button among cards. The
  disclosure button, `ChevronDown` and `aria-expanded` are untouched.

## The guard

`components/more/__tests__/more-row-group-arity.test.ts` fails a **labelled** group holding fewer
than two `MoreRow`s; an unlabelled one is a plain card and is exempt by construction. It also asserts
it found at least four groups, because §5 asked for this to be *asserted* rather than read — the
plan's own inventory was wrong by one when read by eye.

**Mutation-verified:** restoring `label="Developer"` on the single-row Developer group turns it red.
This session shipped four guards that could not fail before that became a habit.

## Verified on `pnpm dev`, not on the device

Rendered `/more` and `/more/settings` through Playwright at the Galaxy viewport, signed in as the
seeded user and again with `is_admin` flipped on:

- Headings on `/more`: `YOUR SETUP | APP` — and nothing else. `/more/settings`: none.
- **Destination parity, clicked rather than read** — every row navigates where it did before:
  Profile details → `/more/details` · Sessions, progression & schedule → `/program` · DEXA & RMR
  results → `/more/clinical` · Ring, strap, scale & permissions → `/more/devices` · Notifications,
  appearance & home layout → `/more/settings` · Data & Sync → `/more/data` · TrainingAI v… →
  `/more/about`. Admin Console (with its pending badge) renders inside `App` for an admin and is
  absent otherwise; `Device consoles & diagnostics` renders on the settings sub-screen with no
  heading above it.
- Goals expands (`aria-expanded` false → true, fields visible), Report an Issue opens the feedback
  sheet, Edit Profile opens its sheet.

**Not exercised:** the S25 itself, which is where *"reads as long and empty"* was diagnosed and the
only place the result can be judged. Safe-area insets render as 0 in the sandbox and the bottom
actions row moved, so the spacing under Sign Out is unverified on-device. `BF-82` stays queued with
`Verify: device`.

## Left open, deliberately

The owner's *"some items could be changed from sliders to text or buttons etc."* is a decision, not a
build, and the plan explicitly does not make it: there are no sliders on this screen. The five
Settings `Switch`es are booleans, where a switch is correct; the likely referent is the typed goal
fields in the Goals accordion. Nothing changed. The question is with the owner and BF-82 keeps it.

## Filed while here

**LB-44** — `scripts/__tests__/dead-repo-methods.test.ts` writes a real `lib/zz-dead-repo-methods-probe.ts`
and deletes it, so any concurrent test that walks `lib/` and reads every file can list it and then
fail `ENOENT` reading it. It fired on this branch's full-suite run in
`lib/media/__tests__/no-data-url-fetch.test.ts` — a file unrelated to the diff, with a message that
reads like a missing source file. Both pass alone. Lane A, since the fix is under `scripts/`.
