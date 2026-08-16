# 2026-08-08 — Triaged the device-local rendering list: 7 benign, 1 fixed, 2 blocked on a missing capability

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domains:** `app-shell`, `platform`

## Why

Earlier the same day, `scripts/check-timezone-rendering.js` shipped with an undifferentiated list of
twelve files that call `toLocaleDateString`/`toLocaleTimeString` without a `timeZone`. That list was
honest but not useful: **"calls toLocale\* without a timeZone" is not by itself a bug**, and leaving
twelve files in one bucket invites either a pointless twelve-file sweep or indefinite deferral.
Every file has now been read and classified.

## The triage

**Benign — 7 files, no work needed.** Each builds its Date from calendar components
(`new Date(y, m - 1, d)`) or from a date string anchored at **local** noon/midnight
(`new Date(s + 'T12:00:00')`, no `Z`). Those are local-time Dates carrying a calendar date, so
rendering them device-local returns the same date in any zone: `nutrition-content`,
`recommendation-card`, `week-day-sheet`, `calendar-widget`, `day-overlay-sheet`,
`weekly-nutrition-chart`, `goals-section`. `goals-section` is the one worth a second look — it uses
`new Date(\`${date}T00:00:00\`)`, which is benign **only because it has no `Z`**.

**A real bug — 1 file, fixed here.** `components/health/strength-trend-card.tsx:42` built its chart
labels with `new Date(h.date + "T00:00:00Z")` — **UTC** midnight — then rendered device-local. On the
owner's Brisbane device that is 10:00 the same day and reads correctly; **anywhere behind UTC it is
the previous evening, so every label showed a day early.** Exactly the class Q-130(b) described. It
now calls `formatDayShort`, the existing single-source helper, whose docstring already warns against
this construction.

*One visible consequence, stated plainly:* the label format changes from `6 Jul` to `Jul 6`, because
that is what the shared helper emits. Keeping `6 Jul` would have meant a second inline copy of the
same formatting, which is what "One Formula, One Place" exists to prevent.

**Real but blocked — 3 files at triage time, 2 by the time this merged.** These render an **absolute instant** (`new Date(ms)`,
`new Date(isoString)`) device-local, so they genuinely shift. They cannot be fixed the way Q-144's
server-side sites were, and the reason is the finding worth carrying:

> **No client component can read the user's timezone at all.** `users.timezone` is on the JWT and
> reaches every API route, but every *client-side* formatter falls back to `DEFAULT_TZ`. Q-144 was
> fixable precisely because it was server-side.

Filed as **Q-148** with an explicit "do not pass `DEFAULT_TZ` and call it fixed" note — that is what
they already effectively do. The work is exposing the session timezone to client components first.

**One of the three left the list mid-review, and it exposed a limit of the check.** While this was
being written, **Q-123 (#1167)** switched `exercise-review-sheet.tsx` from `toLocaleDateString` to
`formatDayShort`/`formatTimeOfDay`. Those take a tz parameter but **default to `DEFAULT_TZ` when none
is passed**, and none is — so the file left this check's scope while still not rendering in the
user's zone. That is a genuine improvement (device-local → a fixed known zone, which at least cannot
drift as the user travels) but it is not the same as correct. **The check matches `toLocale*String`
only and cannot see the shared formatters called without a tz argument**, which is now recorded in
both the script and Q-148 so the sweep covers both forms.

## The script now records the judgement

`GRANDFATHERED` is composed from two named sets, `REVIEWED_BENIGN` and `BLOCKED_ON_CLIENT_TZ`, each
with a per-file comment naming the construction that made the call. Both remain **shrink-only** — the
check fails if a listed file stops matching, so a fix cannot leave a stale entry. Verified both ways:
it passes now at 7 + 2, and planting the just-fixed file back into the list makes it fail by name.

## Also in this change

`docs/domains/platform/README.md` now links the 2026-08-08 DB/scalability review. **That link should
have been in the PR that added the review** — CLAUDE.md requires a new reference doc to be linked
from its pillar index in the same PR, and it was missed. Fixing it here rather than leaving the
index incomplete.

## Not exercised

No device. The strength-trend fix is a pure label-construction change and its wrongness was
established by reading the construction, not by rendering on a non-AEST device — but the failure is
deterministic from `T00:00:00Z` plus a device behind UTC, not conditional on anything unmeasured. The
three blocked files were not touched.
