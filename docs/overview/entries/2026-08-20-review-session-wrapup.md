# 2026-08-20 — Review session wrap-up: sweeps 29–39 closed

**Agent:** Review 📖 · **Branch:** `review/session-wrapup-sweeps-29-39` · **Docs-only.**

Closing the run that produced PRs #140–#151 (sweeps 29–39, findings Q-492…Q-499 and Q-552…Q-556).
Full record: [`docs/handoff-2026-08-20-platform-review-sweeps-29-39.md`](../../handoff-2026-08-20-platform-review-sweeps-29-39.md).

**The reconciliation was the substantive part of the wrap-up, and it found the same class this run
filed.** Eight `projectOverview.md` rows — including a 🔴 for the Health Connect ingest route — still
described findings that had since shipped. That is Q-553's shape exactly: a fixed issue reading as
open in the file every session is required to read first. Leaving them would have been this session's
own version of the bug it filed. Each was verified fixed **in source on `main`** before being struck —
`resolveIngestDate` in the ingest route, `padStart(4,'0')` in `shiftDateStr`, `readJsonLimited` on all
three unauthenticated routes, the `**471**` hex count replaced by a script citation — and then moved
whole to the archive rather than ticked in place.

**10 of 13 findings shipped.** Q-493 landed as #235; Q-494 took the recommended fix (route the date
through the existing `ingest-clock` module) rather than the bespoke range check that would have been
the obvious reading. Three remain open and are named in the baton so they are not re-filed: Q-499,
Q-555, Q-556.

**Two traps recurred during the wrap-up itself**, both already documented by this run, which is mild
evidence the documentation is working. Moving entries between directories broke six relative links —
the same level-shift the compaction chore warns about — and `check-doc-links` caught it. And the
duplication check written in sweep 35 was used to verify this cleanup, confirming no entry ended up
in both lists.

**The ID scheme changed under this run.** Bands are gone; IDs count up from `RV-`. The baton records
that this session's warning about block-claiming was correct — following the old written instruction
literally would have collided with fourteen live numbers.

**Not exercised:** nothing in this wrap-up touched the app. No device, no runtime. The three open
findings carry their own unverified surfaces, and `PATCH /api/activity-logs/<id>/metrics` remains
**unknown rather than clean** — its probe never reached the ownership check.
