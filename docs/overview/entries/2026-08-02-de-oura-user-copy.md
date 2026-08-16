# 2026-08-02 — the app stops presenting as an Oura client (Q-44 Phase 1)

_Branch `refactor/de-oura-user-copy` · PR #1010 · v1.250.12 · domains `app-shell` / `platform`_

Plan: [`docs/superpowers/plans/2026-08-02-de-oura-naming.md`](../../superpowers/plans/2026-08-02-de-oura-naming.md).
**Phase 1 only** — user-visible copy. Phases 2 (182 identifiers) and 3 (22 schema tables) are
deliberately untouched; the plan is explicit that they carry real regression risk and must not be
bundled.

## What changed — eight strings

| Where | Was | Now |
|---|---|---|
| `morning-checkin-sheet.tsx` | `· Oura readiness 54` | `· Readiness 54` |
| `mood-checkin-sheet.tsx` | `· Oura readiness 54` | `· Readiness 54` |
| `readiness-card.tsx` | `Oura base` | `Ring base` |
| `home/home-card-widget.tsx` | `No Oura HR data today` | `No heart-rate data today` |
| `health/oura-section.tsx` | `Oura Ring` (section header) | `Ring` |
| `activity/done-activity-screen.tsx` | `Fetching HR from Oura…` | `Fetching heart rate…` |
| `workout/hr-recovery-chart.tsx` | `No HR data — will appear once Oura syncs` | `No heart-rate data — will appear once your ring syncs` |
| `more-content.tsx` + `health-content.tsx` | `Oura sync failed` | `Ring sync failed` |

## Two things the sweep turned up

**"Oura readiness" was factually wrong, not just vendor-named.** The morning check-in sheet is
passed `readiness?.score` — the app's **own** composite score, not Oura's. It has been labelling our
number with their name. The prop comment said the same thing and is corrected alongside it. The mood
sheet carries the identical string; its own call site could not be checked because **the component
appears to be unreferenced** — a Phase 2 deletion candidate, noted rather than acted on here.

**"will appear once Oura syncs" was also stale.** The ring has been read over direct BLE since the
2026-07-07 re-key; the Oura Cloud gets no new data from it. The replacement says "your ring", which
is both neutral and true.

## Two exemptions, stated so a later sweep does not "finish the job"

1. **`app/admin/**` and `components/admin/**` keep vendor names.** They are diagnostic surfaces where
   the vendor *is* the subject; neutralising them makes debugging harder. This is the plan's own
   carve-out.
2. **`components/more/oura-section.tsx` keeps its vendor names.** It is the pairing and OAuth
   surface — "Connect with Oura", "Authorise via Oura Cloud", "Oura Ring 5" on the connected card.
   The user is authorising Oura specifically, and a neutral label there would be misleading rather
   than source-agnostic. This is the plan's "where a specific device genuinely must be named (a
   pairing screen, a connection error)" case.

Comments, identifiers, filenames and table names are all out of scope per the plan; ~40 `Oura`
mentions in comments remain and are correct where they describe the vendor's data or protocol.

## Verification

`tsc` clean, eslint clean (0 errors), full suite green.

Rendered at 412 px: the **Ring** section header on Health → Body, and the Home screen. Both lay out
normally.

**Not observed rendering:** the five conditional states — the two check-in sheets (need the morning
prompt), `Ring base` (needs an Oura Cloud score, which is frozen post-re-key), the done-activity
fetching line (transient), and the HR-recovery empty state (needs a workout with no HR). Six of the
eight replacements are the same length or shorter than what they replaced, so wrap risk is confined
to `No heart-rate data today` (+3 characters) and the HR-recovery line (+13, inside a centred
flex container that already wraps).
