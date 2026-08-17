# 2026-08-17 — Owner bug-batch wrap-up: Q-310 found, four earlier reports confirmed already shipped

Five owner-reported bugs worked across this session (screenshots spanning 2026-08-14 through
2026-08-17). Docs-only wrap-up; no runtime code in this PR beyond what already shipped separately.

## What this session found and queued

**Q-310** (still open) — an ai_dynamic deload phase reached via `app/api/workout-data/route.ts`'s
generic fallback branch (two identical copies) gets the correct display name "Deload" but hardcodes
`isDeloadActive: false` / `phaseType: 'normal'`. Every real consumer of that flag — weight
prescription and the `shouldCountTowardPr` PR gate — reads a normal session, so the label is
cosmetic: weights don't drop and a genuine `personal_records` row can be written from work that
should have been submaximal. Traced from two screenshots (an active set with weight climbing during
a labeled "Deload" session, and the exercise summary right after firing "New Personal Record!").
PR #1398. Filed near the top of the queue given the severity — a live prescription/data-correctness
bug, not cosmetic.

Also fixed directly (not queued — a one-line, certain root cause): the warm-up screen's `/ 10:00`
denominator was a hardcoded literal, ignoring the session's real budget-scaled goal. A session whose
real target was 9 minutes correctly completed at 9:00, but the label still claimed 10:00. PR #1350.

## What this session queued earlier, then found already shipped

Q-245, Q-246, Q-247 and Q-248 were all filed by this session (as documented investigations, no code)
across earlier turns. By the time this wrap-up was written, all four had already been picked up and
shipped by other, independent parallel sessions — PR #1375 (v1.317.0) for Q-245/246/247, and
v1.317.1 for Q-248. This was caught by checking `packages/shared/src/changelog.ts` directly rather
than assuming the queued state was still current, after the changelog was found to already describe
all four as done in versions this session's own branches never touched.

Corrected as part of this wrap-up: the `docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`
Task headings (49–51) now carry `SHIPPED` annotations pointing at the real implementation journal
entries, including two things each implementation found that the original investigation didn't — a
sibling bug in Q-246 (a pure testing day was also showing the deload "D" marker) and a needed `drop`
case in Q-245's fix that the queued direction hadn't called for. The `docs/domains/readiness/README.md`
Open Issues entry for Q-248, written before this discovery, is corrected from "open" to a struck
`~~...~~` shipped entry with the same honest caveat the implementing session recorded: the
device-repro this session's own entry called for still never happened.

## Documentation touched

- `docs/implementation-backlog.md` — Q-310 added near the top (only entry from this batch still
  present; Q-245/246/247/248 were already correctly removed by their implementing sessions).
- `docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md` — Task 52 (Q-310, open), Task 53
  (warm-up fix, shipped), and `SHIPPED` corrections to Tasks 49–51.
- `docs/domains/workouts/README.md` and `docs/domains/readiness/README.md` — Open Issues and History
  sections updated; the readiness Q-248 entry corrected mid-session per the discovery above.
- `projectOverview.md` — new Known Issues row for Q-310 (🔴, open); a note in the Q-49 public-repo
  section that `main` kept moving after the 2026-08-16 snapshot (`c9df8db`) and that gap needs an
  explicit decision at archive time, not an assumption of sync.
- New handoff: [`docs/handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md`](../../handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md).

## Verification

Docs-only — no runtime code changed in this PR. `node scripts/check-doc-links.js` run clean.
Confirmed via `git log --grep` and direct file reads that the Q-245/246/247/248 shipped claims are
real (commits `61507d3` and `051097a` on `main`, both with tests and their own journal entries), not
assumed from the changelog text alone.

## Not exercised

Nothing device- or runtime-verified in this PR — it is documentation only. The underlying code
changes it describes (PR #1350, and the other sessions' #1375 / v1.317.1) carry their own,
already-recorded verification status; this entry does not re-verify them.
