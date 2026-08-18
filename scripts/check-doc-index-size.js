#!/usr/bin/env node
// Keeps the orientation documents readable. Same ratchet shape as check-component-size.js.
//
// These files are what every session reads before it can start, and they are the ones that rot,
// because appending to them is always the locally cheapest move. By 2026-08-17 projectOverview.md
// had reached 9,647 lines — 3,361 of them a Current Status section holding 157 dated notes in no
// date order, describing work going back ten weeks — while its own opening line called it a lean
// index. The backlog carried a 397-line header, 268 of which were one nested chain of
// "Previously N (updated ... Previously N (updated ...". Prose asking for restraint did not hold;
// nothing measured it.
//
// So: a shrink-only baseline. A file may sit at or below its recorded size and may never grow.
// A change that genuinely has to add lines raises the number here in the same PR, which puts the
// growth in the diff where it can be seen, rather than letting it drift up one commit at a time.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Baseline recorded 2026-08-17, immediately after the cleanup that produced these numbers.
//
// Raised 2026-08-17 (Tuning, Q-500/Q-501): backlog 5698 -> 5722, projectOverview 6372 -> 6382.
// Two new queue entries replacing one (Q-271 superseded by Q-500, plus Q-501) and one rewritten +
// one new Known-Issues row. This is queue and open-issue content, which is what these two files are
// for — the growth the ratchet exists to catch is narrative and dated notes, not entries.
//
// Raised 2026-08-17 (Review, Q-450…Q-455): backlog 5722 -> 5903, projectOverview 6382 -> 6428.
// Six new queue entries from the failure-cells sweep and the one Known-Issues row that indexes
// them. Same justification as above: entries, not narrative. The sweep's actual prose lives in
// docs/reviews/2026-08-17-failure-cells-running-the-app.md, which this ratchet does not govern —
// which is the split it is meant to enforce.
//
// Raised 2026-08-17 (BugFix intake, Q-387): backlog 5945 -> 5972, projectOverview 6443 -> 6461.
// One owner-reported queue entry and its Known-Issues row — entries, per the same split as the two
// raises above. Recorded because the first draft was 24/48 over and the ratchet was right to catch
// it: the trace, the measured table and the three-option assessment are what an implementer needs,
// and roughly a third of the rest was showing the work. Intake adds an entry per report, so this
// ceiling will be pushed regularly — the answer is a periodic sweep moving *cleared* entries out,
// not a standing allowance for verbose ones.
//
// Raised 2026-08-17 (BugFix intake, Q-388): backlog 5972 -> 6057, projectOverview 6461 -> 6484.
// One owner-reported queue entry, and a deliberately larger one: ~20 of its 85 lines are measured
// production tables (7-day event counts by tag, and by hour of day) behind an owner-scoped
// claude_ro view that **prunes at 30 days**. Re-deriving them after that window is impossible, so
// they are preserved in the entry rather than cited. The prose around them was cut from a first
// draft 100 over. If a later sweep moves this entry out, the tables go with it.
//
// Raised 2026-08-17 (Q-530 planning): backlog 6057 -> 6154, projectOverview 6484 -> 6488.
// One queue entry for the planned snapshot endpoint, plus a re-measurement folded into the existing
// Q-288 rather than filed as a second entry. The projectOverview half is three lines correcting a
// wrong number already in the index (/api/export covers 26 of 82 tables, not 27 of 80) and naming a
// defect that changes how it must be fixed — a correction to an existing row, not new narrative.
// The backlog half also carries Q-530's ordered step list and the new optional `Lane:` field on
// Q-530/Q-288 — routing an implementer to the right lane and flagging a shared unlisted path, which
// is queue mechanics rather than narrative and is exactly what this file governs.
//
// Raised 2026-08-17 (Lane A, Q-536 diagnosis): backlog 6417 -> 6474. The Q-536 rewrite (+19) replaces
// a refuted diagnosis with the measured one and keeps the refuted text folded in a <details>, which
// is the cheapest way to stop it being re-derived; Q-314 (+38) is the new queue entry for the root
// cause, +8 more when Q-536's repair shipped and its entry had to say which half is done. Entries
// and a corrected entry, per the same split as the raises above. projectOverview
// 6547 -> 6568 for Q-536's Known-Issues row: a live, unrepaired data-correctness fault on displayed
// health values, which is exactly what that section indexes. +3 more when the repair shipped, to
// say which half is done and which is still owed — the distinction the row exists to carry.
// Raised 2026-08-17 (one-off DB-storage planning session, Q-530…Q-535): backlog 6057 -> 6191,
// projectOverview 6484 -> 6505 — this session added 134 and 21 lines respectively, and the two
// raises landed the same day, so these numbers are the sum rather than either branch's figure.
// Both were recomputed from the merged files rather than spliced from the conflict hunks, which is
// how a merge of two same-day ratchet raises silently drops one side. Six queue entries and one
// Known-Issues row — entries, per the same
// split as the raises above. The analysis itself (the measurements, the five costed options, the
// D4 prerequisite audit) is in docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md,
// which this ratchet does not govern. Two of the six entries are blocked on an owner decision and
// carry the "what this irreversibly gives up" summary inline deliberately: an implementer must not
// have to open the plan to discover that the item is a one-way door.
//
// Raised 2026-08-17 (DB-storage planning, renumbered to Q-538…Q-542 on merge): -> 6594 / 6597.
// Five queue entries plus an amendment folding two more into a concurrent session's Q-534 rather
// than filing duplicates of it. The amendment is longer than a cross-reference because it corrects
// a measured claim in that entry (autovacuum had run; the null reading was a post-crash statistics
// artifact) and a wrong correction is more expensive than a long one.
//
// Raised again 2026-08-17 for the disk_full incident (Q-536): backlog -> 6235, projectOverview -> 6534.
// A live production outage entry and its Known-Issues row. Both carry the proven mechanism inline
// (n_tup_upd=681,005 with n_tup_hot_upd=0) rather than citing it, because the counters reset at
// crash recovery and cannot be re-derived later — the same reasoning as the Q-388 raise above.
//
// Raised 2026-08-17 (Lane A, Q-536): projectOverview 6618 -> 6642, backlog 6584 -> 6649. The Q-536
// entry rewrite replaces a refuted diagnosis with the measured one and says which half of the repair
// shipped and which is still owed; Q-314 is the new queue entry for the root cause; the
// projectOverview row is a live, unrepaired fault on displayed health values. Entries and a
// corrected entry, per the same split as the raises above.
//
// Raised 2026-08-17 (Lane A, Q-536 follow-up): projectOverview 6647 -> 6653, backlog 6649 -> 6665.
// v1.318.0's migration rolled back in production on every boot and the repair never landed; both
// entries now say so, because "shipped" was recorded here and was false. A correction to an existing
// row and an existing entry, which is the cheapest possible place to carry it.
// Raised 2026-08-17 (Lane A): backlog 6649 -> 6671. Two measured corrections onto Q-534 — its
// finding 4 is not a drop-in index drop (the index has two live consumers that would become
// sequential scans of the largest table), and the redecode's own re-stamp cost, which that entry
// gates but did not quantify. Both are corrections to an existing entry, which is cheaper to carry
// here than to have an implementer discover by dropping the index in production.
//
// Raised 2026-08-17 (Review, Q-456…Q-459): projectOverview 6655 -> 6679. One Known-Issues row
// indexing the repo-migration architecture sweep. Entries and open-issue content, not narrative —
// the sweep's prose is in docs/reviews/2026-08-17-repo-migration-architecture.md, which this
// ratchet does not govern.
//
// Raised 2026-08-17 (BugFix intake, Q-389): backlog 6682 -> 6700. One owner-requested feature entry
// (printable saved-meal labels). Only +18 because a sweep had left the file 47 under its ceiling —
// which is the intended cycle working: entries land, cleared ones leave, the number does not ratchet
// on every single filing.
//
// Raised 2026-08-17 (BugFix intake, Q-389 amendment): backlog 6700 -> 6721. The owner settled the
// two questions the entry was waiting on (50x50mm label; name + calories + code, macros optional;
// handwritten date line), so the "open questions" block became a spec. +16 net for replacing four
// lines of questions with the answers plus the QR quiet-zone/payload constraint the mockups
// surfaced. Amended in place rather than filed as a second entry, per this role's dedup rule.
//
// Raised 2026-08-17 (Lane A, Q-541 tasks 0-2): backlog 6721 -> 6731. A status block on the Q-541
// entry saying which tasks shipped and which remain, and that nothing reads the new table yet. The
// item stays in the queue, so this is queue state rather than narrative — and the distinction it
// carries is the one an implementer most needs: the destructive step has not been written.
// Raised 2026-08-17 (BugFix intake, Q-389 round-label revision): backlog 6721 -> 6735. The owner
// added that labels rotate between square and CIRCULAR dies, which changes the binding constraint
// from the square to the inscribed circle, and removed the per-serving line. Both are spec changes
// an implementer would otherwise build against wrongly, plus the measured consequence: circle-safe
// composition shrinks the code to 12.2-15.9mm and print ink-spread is the failure mode to expect.
// Raised 2026-08-17 (Q-530 secret settled): backlog 6770 -> 6781. Q-530's step-3 gate flipped from
// "blocked on the owner" to the settled decision, plus the two operational notes that stop the next
// session misreading it — a stale container reading the variable as absent, and the fact that
// nothing can verify either copy until the route exists.
//
// Raised 2026-08-18 (BugFix intake, Q-389 multi-style + 25x25 redraw): all four label styles ship
// with the user cycling between them, black band as the owner's default, the write-on line loses its
// MADE word, and the mockups are redrawn with the 25x25 code a meal id actually needs. The build
// consequence is the part worth carrying: the renderer becomes template-lookup rather than one
// baked-in layout. Also records the measured pitch at 25x25 (band, the default, is tightest at
// 0.487mm) and that it cannot be recovered without dropping content — with the drawn variant that
// shows the cheapest way to. Merged with a concurrent session's work on the same entry rather than
// over it, and rebuilt from origin/main's numbers: this file conflicted four times in one evening,
// and splicing is how one side gets silently dropped.
// Raised 2026-08-18 (Review, Q-460…Q-462): projectOverview 6689 -> 6735, backlog 6781 -> 6927 (recomputed on the third same-day merge of this file).
// Three queue entries from the workout write-path sweep plus the Known-Issues row indexing them.
// Entries and open-issue content, which is what these files are for; the sweep's prose lives in
// docs/reviews/2026-08-18-workout-write-path.md, outside this ratchet.
//
// Raised 2026-08-18 (BugFix intake, Q-390): one owner-reported queue entry. The owner asked for a
// cosmetic change — render the deload flag as "Mon (D)" rather than on its own line — and the trace
// found the flag is an extra flex row inside an items-end container, so a flagged day's bar sits
// ~12px higher than an unflagged one on a chart whose purpose is comparing days. The entry carries
// the geometry, because that is the part an implementer would otherwise fix cosmetically and leave
// broken. Rebuilt from origin/main's numbers rather than spliced.
//
// Raised 2026-08-18 (BugFix intake, Q-391): one owner-reported queue entry. The owner asked for a
// calories-burnt stat on the day screen's Training card. The trace found the feature had already
// been considered and deliberately deferred, with both the blocker (estWorkoutKcal from a client
// component) and the intended shape (server-side in /api/day-log) already on record — so the entry
// cites that rather than re-deriving it, and carries the two things that would otherwise be got
// wrong: the existing workoutKcal is a DAY total already rendering in the same screen's Energy
// section, and the estimate is duration-only, so sitting it beside measured volume implies a
// derivation that does not exist.
//
// Raised 2026-08-18 (BugFix intake, Q-392): +64 for one owner-reported queue entry — preferences are
// localStorage-only, so a reinstall or a second browser starts from defaults. Most of the length is
// the inventory table of which preference lives in which key and file, which is the work an
// implementer would otherwise repeat. Also records that the pattern already exists (Q-241 made goals
// server-authoritative and left hydrateGoalSeeds behind), and that users.food_region is a dead
// column whose setting is device-only — the cheapest possible proof of the approach.
const BASELINE = {
  // Raised again the same day for Q-310's Known-Issues row: a shipped fix that still owes a device
  // check, so it belongs here rather than in the resolved archive, which only takes an entry when
  // nothing is still owed. The evidence lives in the journal entry; only what is owed is here.
  //
  // Raised 2026-08-17 (Q-532, Lane B): 6547 -> 6562. Same shape as the line above and the same
  // justification — a shipped fix owing a device check cannot go to the resolved archive. Fifteen
  // lines for three facts a session must not have to dig for: the sandbox cannot reproduce this at
  // all, so the owner's drain run is the only verification; and no regression guard exists, because
  // neither vitest (node-only, no @testing-library/react) nor the E2E harness (needs admin + a live
  // radio) can reach the code. The mechanism, the five-site sibling sweep and the CI-rule option
  // that was considered and declined all stayed in the journal entry.
  // Raised 2026-08-17 (Q-451, Lane B): 6653 -> 6655. Recomputed from the merged file, not spliced
  // from the conflict hunk — this raise and the Lane A one above it landed the same day, which is
  // the exact case this file's earlier note says silently drops one side.
  // Striking a fixed item usually shrinks this and this one nearly did (the replacement bullet was
  // cut from 12 lines to 7). The two it is over are the two the original entry had no reason to
  // carry: that the fix is **observed but not guarded**, and the Q-352 pointer to why. A struck item
  // that can silently regress is exactly what a session must not have to discover for itself.
  //
  // Raised 2026-08-17 (Q-281, Lane B): projectOverview 6679 -> 6689, backlog 6735 -> 6770. Same
  // shape as the two raises above and the same reason: a shipped fix owing a device check cannot go
  // to the resolved archive. The ratchet was right to catch the first draft at 20 over — the audit's
  // findings, the FactorBar judgement call and the Q-278 corrections all moved to
  // docs/reviews/2026-08-17-score-presentation-audit.md, which this file does not govern. What is
  // left is the owed check (a 7.5px band word, verified only in a browser harness, on a style the
  // owner selects) and the one pointer that stops Q-278 being planned on premises this audit
  // refuted. Two stale lines were corrected in the same pass: the version, four minors out of date,
  // and an open-PR snapshot naming three PRs of which two had long since closed. The backlog half is
  // Q-281's audit result folded into its entry plus the two refuted premises annotated onto Q-278 —
  // a correction to an existing entry, which is cheaper here than an implementer discovering it.
  //
  // Both numbers are RECOMPUTED FROM THE MERGED FILES, not spliced: this raise collided with the
  // Q-389 backlog raise directly above, which is the same-day collision this file keeps warning
  // about. Splicing would have kept 6682 and silently un-done Q-389's raise.
  // Raised 2026-08-17 (Q-389 planning, Lane B): backlog 6781 -> 6791. Recomputed from the merged
  // file — this collided with a concurrent raise to 6781, exactly the same-day collision this file
  // keeps warning about, and splicing would have silently un-done that side. Three corrections folded into
  // the existing Q-389 entry rather than filed separately, per the "a wrong correction is more
  // expensive than a long one" precedent above: its QR module maths was ~16% optimistic (a 21x21
  // code cannot hold a UUID at all — v1 holds 17 bytes, so the floor is v2 25x25 and the pitch is
  // 0.49-0.64mm, on a margin the entry already calls thin); its per-serving worry is already
  // satisfied by oneServingItems; and that in turn exposes the real bug, that SavedMeal.totals is
  // the whole recipe, so a naive renderer prints double what scanning the label logs. Each is
  // corrected where the wrong claim lives, so an implementer cannot read the stale number and build
  // to it. The plan itself is in docs/superpowers/plans/, which this ratchet does not govern.
  //
  // Raised 2026-08-18 (Q-541 task 3, Lane A): 6735 -> 6744. Nine lines onto the disk-full item, and
  // eight of them exist to stop a reader drawing the wrong conclusion from the other eight raises:
  // Tasks 0-3 have shipped and the database has NOT shrunk by a byte, because nothing writes a blob
  // yet. Without that the section reads as progress against the 500 MB deadline when there is none.
  // Carries the re-measured 819 MB (up from 786) and the Q-315 pointer. Recomputed from the merged
  // file.
  // Raised 2026-08-18 (Tuning, Q-503 Sleep Score recalibration): 6735 -> 6751. One Known-Issues row
  // for the shipped recalibration, marked ⚠️ not ✅ because two things are still owed — an unmarked
  // step in the trend chart where the old and new model scores meet, and no device verification.
  // Recomputed from the MERGED file rather than spliced: this collided with same-day raises from
  // other lanes twice, which is the case the note below warns silently drops one side.

  //
  // Raised 2026-08-18 (Q-534 finding 4 / Q-541 task 7, Lane A): 6843 -> 6853. Ten lines on the
  // disk-full item, and they carry the one distinction that item most needs: the outage's MECHANISM
  // is gone, not merely mitigated — with every reader deriving the timestamp, the re-stamp that
  // rewrote 681,005 rows is a no-op. Plus the caveat that keeps the number honest: 136 MB is the
  // measured index size, not a reclaim that has happened, since the drop runs on the next deploy and
  // the space only returns to the file after a VACUUM FULL.
  //
  // Raised 2026-08-17 (Q-541 tasks 0-2, Lane A): 6791 -> 6801. RECOMPUTED FROM THE MERGED FILE on
  // each of the two merges this branch took, not spliced — the Q-530, Q-389 and Lane A raises all
  // landed the same day and each pass would have silently un-done the other side.
  //
  // Raised 2026-08-17 (Q-51 re-verification, Lane B): backlog 6833 -> 6853. A correction to an
  // existing entry whose Task 3 reads as closing it and does not: Task 3 measured HOME cold start
  // (FCP 472ms, 439 of it the document fetch), while the entry's own callout is about first mount of
  // /WORKOUT (1086-1348ms, rscCount 0, entirely client-side). Different screen, different number,
  // still unmeasured. Also re-measures the two file sizes the premise rests on — both have grown
  // since the entry was written, and the entry states one of them three different ways. Left in the
  // entry rather than a review doc because the next session to take this item reads the entry, sees
  // a green Task 3, and would close it. Recomputed from the merged file, same as the raise above.
  //
  // Raised 2026-08-18 (Q-541 task 3, Lane A): 6853 -> 6867. The Q-541 entry's status block gains
  // fourteen lines and none of them are narrative: which read sites moved, and the three findings an
  // implementer of tasks 4-7 would otherwise re-derive — that an aggregate cannot use the reader's
  // identity dedupe (it double-counted 80 frames as 120), that event_name had to become derived, and
  // that a dormant tag needs a cold fallback in three places. The rest of the story is in the plan
  // and the journal entry, neither of which this ratchet governs. Recomputed from the merged file.
  //
  // Raised again the same day for the new Q-315 entry: 6867 -> 6894. `error_events` holds 4 live rows
  // in 49 MB, found while measuring production for Q-541 — 6% of the database, reclaimable by one
  // statement. Filed rather than taken, per "no orphaned findings", and it earns its 27 lines by
  // carrying the measurement, the reason nothing re-grows (Q-539 already fixed the write path), and
  // the free-disk caveat that decides whether it can run after the volume is cut back.
  //
  // Recomputed 2026-08-18 from the MERGED file after Lane A's Q-541/Q-315 raises met a concurrent
  // one: 6894 + the other side's delta = 6988. Both prose blocks above are kept and only the number
  // was rebuilt — splicing either conflict hunk would have silently un-done the other lane's raise,
  // which is what every note in this file keeps warning about.
  // Raised 2026-08-18 (Tuning, Q-504): 6947 -> 6979. One queue entry for the Readiness range
  // recalibration, carrying the measured before/after table for the five action thresholds that ride
  // on the readiness scale — the reason the item is held rather than shipped.
  //
  // Recomputed 2026-08-18 (Q-541 task 3, Lane A) from the MERGED files, both numbers rebuilt rather
  // than spliced: this branch's raises met concurrent ones on both files in the same day, which is
  // the collision every note above warns about. Lane A's own deltas were +9 on projectOverview (the
  // disk-full item now states that Tasks 0-3 shipped and the database has NOT shrunk by a byte,
  // without which the section reads as progress against the 500 MB deadline where there is none)
  // and +41 on the backlog (the Q-541 status block, and the new Q-315 entry for error_events
  // holding 4 live rows in 49 MB).
  //
  // Raised 2026-08-18 (Q-541 task 4, Lane A): 7020 -> 7055. Two things: the Q-541 status block gains
  // the packer's settled decisions, and Q-316 is a NEW entry — the packer has no button because
  // components/** is Lane B's, so the affordance is filed rather than written. Its 23 lines are what
  // stop the next lane building the wrong thing: the route contract it should call, and the warning
  // that its confirm copy must not read like the lossless VACUUM beside it, because this is the one
  // control in the app that deletes archival frames.
  // Raised 2026-08-18 (Q-389 shipped, Lane B): projectOverview -> 6862, backlog -> 7109, BOTH
  // recomputed from the merged files after a fourth same-day ratchet collision on this branch.
  // The backlog number is DOWN on the incoming 7276 because Q-389's 145-line entry was removed on
  // completion, which is what finishing an item is supposed to do to this file. A shipped feature whose
  // two remaining checks are both PHYSICAL and cannot be automated at all: a test print (the QR is
  // 0.49-0.66mm per module, so ink spread is the expected failure and it presents as "the scanner is
  // broken"), and the camera scan path, which the Capacitor plugin makes unreachable from the
  // sandbox. Neither can go to the resolved archive while it is still owed, and neither is
  // discoverable from the diff. The backlog SHRANK by 145 lines in the same PR - Q-389's entry was
  // removed on completion - so the net across both index files is well down.
  // Raised 2026-08-18 (Tuning, Q-505): 7020 -> 7056. One queue entry for the Activity Score decision,
  // carrying the measured cause and the two coherent answers inline — the item is blocked on the
  // owner choosing between them, and an implementer must not have to open the review to learn that.
  // Recomputed from the MERGED file; this is the third same-day ratchet collision on this branch.
  //
  // Recomputed 2026-08-18 (Q-541 task 4, Lane A) from the MERGED files — all three numbers rebuilt,
  // not spliced, because both files moved on both sides of this merge. Lane A's own delta was the
  // Q-541 status block for the packer plus the new Q-316 entry (the packer has no button, because
  // components/** belongs to the other lane, and the entry carries the warning that its confirm copy
  // must not read like the lossless VACUUM beside it).

  //
  // Recomputed 2026-08-18 (Q-541 task 4, Lane A) from the MERGED files — every number rebuilt, no
  // hunk spliced. Lane A's own delta was the Q-541 packer status block plus the new Q-316 entry
  // (the packer has no button, because components/** belongs to the other lane, and the entry
  // carries the warning that its confirm copy must not read like the lossless VACUUM beside it).
  //
  // Raised 2026-08-18 (Q-315 route, Lane A): 7144 -> 7156. Twelve lines splitting Q-315 into the half
  // that shipped and the half that has not: the route exists and is verified, and nobody has pressed
  // it against production. Without that split the entry reads as done and the 49 MB never gets
  // reclaimed. Carries the one thing an implementer must not get wrong — the allowlist is the safety
  // boundary because the table name is interpolated, and `in` accepts `toString` where
  // `hasOwnProperty` does not.


  //
  // Recomputed 2026-08-18 (Q-534 finding 4 / Q-541 task 7, Lane A) from the MERGED files. Lane A's
  // own deltas: +10 on projectOverview, carrying the distinction that item most needs — the outage's
  // MECHANISM is gone, not merely mitigated, because with every reader deriving the timestamp the
  // re-stamp that rewrote 681,005 rows is a no-op — plus the caveat that keeps the 136 MB honest (it
  // is the measured index size, not a reclaim that has happened). On the backlog, finding 4 is
  // struck in place with the three consequences the entry did not anticipate, so the next session
  // does not re-derive them or assume findings 1-3 went with it.
  // Raised 2026-08-18: 1010 -> 1044. The "Decisions That Come Back To Me" section, which sets the
  // default shape for anything gated on an owner decision — recommendation first, alternatives with
  // what each is better at, reversal cost, plain English — and pushes cheap reversible choices back
  // down to the session rather than surfacing them. It belongs in the index: it governs every
  // session's behaviour rather than recording one session's work. Drafted at 49 lines and cut to 34
  // before raising, since a rule about brevity that arrives verbose argues against itself.
  // Recomputed from the MERGED file after three same-day collisions with concurrent raises.

  //
  // Recomputed 2026-08-18 (Q-534 finding 4 / Q-541 task 7, Lane A) from the MERGED files, on each of
  // the two merges this branch took. Lane A's delta: +10 on projectOverview carrying the one
  // distinction that item needs — the outage's MECHANISM is gone rather than mitigated, because with
  // every reader deriving the timestamp the re-stamp that rewrote 681,005 rows is a no-op — plus the
  // caveat that keeps the 136 MB honest (measured index size, not a reclaim that has happened). On
  // the backlog, finding 4 is struck in place with the three consequences the entry did not
  // anticipate, so the next session neither re-derives them nor assumes findings 1-3 went with it.

  //
  // Recomputed 2026-08-18 (Q-315 route, Lane A) from the MERGED file. Lane A's delta was +12,
  // splitting Q-315 into the half that shipped and the half that has not: the route exists and is
  // verified, and nobody has pressed it against production. Without that split the entry reads as
  // done and the 49 MB never gets reclaimed.

  'projectOverview.md': 6871,
  //
  // Recomputed 2026-08-18 (Q-315 route, Lane A) from the MERGED file, on each merge this branch
  // took. Lane A's delta was +12, splitting Q-315 into the half that shipped and the half that has
  // not: the route exists and is verified, and nobody has pressed it against production. Without
  // that split the entry reads as done and the 49 MB never gets reclaimed.
  // Raised 2026-08-18 (owner-directed session, Q-543): -> 7257. One entry for the doc-index BASELINE
  // object being the repo's most reliable merge conflict — three of the four CI rounds on #69 were
  // base collisions on THIS object, none on the content being changed, and filing the entry hit it a
  // fourth time. Recomputed from the MERGED file.
  // Raised 2026-08-18 (Tuning): -> 7366, recomputed from the MERGED file. Q-506 — the illness radar
  // has never produced an action-bearing flag in 46 days because one of its four biomarkers is scored
  // against a baseline whose deviation is 18.7x too large. The measured biomarker table and the
  // cold-start numbers are the entry: without them the next reader lowers the threshold instead of
  // fixing the baseline, which is the mistake Q-504 already made and reverted.
  // Raised 2026-08-18 (Tuning): 7366 -> 7454. Q-507/Q-508, the last two un-calibrated scores. Both
  // entries carry measured tables rather than conclusions on purpose: Q-507's whole point is that a
  // 16% firing rate looks healthy until you see WHICH days fire (mean readiness 79 against 65), and
  // Q-508's is that the golden vector cannot catch the defect, which only lands with the arithmetic
  // shown. Strip either table and the next reader tunes the constant. Recomputed from the MERGED file.
  // Raised 2026-08-18 (Tuning): 7462 -> 7516. Q-509/Q-510, both BLE-era input drift. Q-509's entry
  // carries the anchor-vs-input ratio table because that ratio IS the finding — drop it and the entry
  // reads as "refit says 3.31, ship 3.31", which is the exact conclusion the readiness code
  // pre-registered against. +10 marking Q-501's "did it land" half resolved — both recalibrations are
  // now verified live, and leaving the entry claiming otherwise would send the next reader chasing a
  // ship that already happened. Recomputed from the MERGED file.
  'docs/implementation-backlog.md': 7526,
  'CLAUDE.md': 1044,

};

// docs/overview/entries/ is a holding area. Its README sets the compaction chore at ~20 files;
// that is a chore trigger, not an error, so CI does not fail there — failing at 20 would block
// unrelated PRs for a tidiness task. This is the runaway guard instead: the directory reached 509
// before anyone swept it, and at that size it stops being a readable recent-window.
const ENTRIES_DIR = 'docs/overview/entries';
const ENTRIES_CHORE = 20;
const ENTRIES_LIMIT = 60;

const failures = [];

for (const [rel, limit] of Object.entries(BASELINE)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel} is in the baseline but does not exist — remove its row or restore it.`);
    continue;
  }
  const lines = fs.readFileSync(abs, 'utf8').split('\n').length;
  if (lines > limit) {
    failures.push(
      `${rel} is ${lines} lines, over its ${limit}-line baseline by ${lines - limit}.\n` +
        `      Move the new material to where it belongs — a journal entry, an archive, a reference\n` +
        `      doc — or raise the baseline in this file in the same PR if the growth is genuinely\n` +
        `      part of the index.`,
    );
  }
}

const entriesAbs = path.join(root, ENTRIES_DIR);
if (fs.existsSync(entriesAbs)) {
  const count = fs
    .readdirSync(entriesAbs)
    .filter((f) => f.endsWith('.md') && f !== 'README.md').length;
  if (count > ENTRIES_LIMIT) {
    failures.push(
      `${ENTRIES_DIR}/ holds ${count} loose entries, over the ${ENTRIES_LIMIT} runaway limit.\n` +
        `      Run the compaction sweep in ${ENTRIES_DIR}/README.md: fold them oldest-first into a\n` +
        `      batched docs/overview/history-*.md, starting a new one near ~250 KB, then git rm the\n` +
        `      folded files.`,
    );
  } else if (count >= ENTRIES_CHORE) {
    console.log(
      `check-doc-index-size: note — ${ENTRIES_DIR}/ holds ${count} entries, at or over the ` +
        `${ENTRIES_CHORE}-file compaction chore threshold. Not a failure; sweep it when convenient.`,
    );
  }
}

if (failures.length) {
  console.error('Doc index size check failed:\n');
  failures.forEach((f) => console.error('  • ' + f + '\n'));
  process.exit(1);
}

const sizes = Object.keys(BASELINE)
  .map((r) => `${r} ${fs.readFileSync(path.join(root, r), 'utf8').split('\n').length}`)
  .join(' · ');
console.log(`check-doc-index-size: OK — ${sizes}`);
