# Tuning Agent 🎶 — baton

> **Successor sessions are titled `Tuning Agent 🎶`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** `claude/tuning-agent-role-x9jg4r` · **Q band:** 500–529 (next free: 503)

## Now
Nothing in flight. The Recovery Index anchor is measured and written up, and the owner has been asked
to decide. Evidence in [`docs/reviews/2026-08-17-readiness-calibration.md`](../../reviews/2026-08-17-readiness-calibration.md),
method and gotchas in [`docs/handoff-2026-08-17-readiness-recovery-index-calibration.md`](../../handoff-2026-08-17-readiness-recovery-index-calibration.md).

## Next
Wait for the owner's next observation about a score that did not match how they felt.
**Q-272 (Body Battery) was started and is deliberately unfinished** —
[`docs/reviews/2026-08-17-body-battery-calibration.md`](../../reviews/2026-08-17-body-battery-calibration.md)
says exactly where it stopped and why. Resume there, and do **Q-502 first**: the tuning substrate is a
biased sample of each day, so a constant fitted now is fitted to the owner's app-opening habits.
The §4 replay does **not** reproduce production — reconstruct 2026-08-05 (88% capture) rather than a
1.9% day, and add the stress-drain term, before trusting any counterfactual.
Q-277 (Activity Score occupies a quarter of its range) is the other standing calibration question.

## Blocked
- **Q-500 — `RECOVERY_INDEX_OPTIMAL_HOURS` 6 → 5. Waiting on the owner.** One sentence for them: *the
  Recovery Index term in readiness is scored against a 6-hour target about an hour too high; fitting it
  against Oura's own version of the same contributor puts the target at 4.63 h, and moving it to 5
  lifts 40 of the last 41 days by at most 1.4 readiness points and lowers none.* If approved it is
  Lane A's, one constant, and **Q-273 (model versioning) lands first or a readiness version stamp
  rides along**.
  **The owner's stated blocker was not the size of the change but its consequences, so §5.2 of the
  review now answers exactly that** and is the section to point them at: 4 of 26 days cross a
  threshold — three go 74 → 75 (rest-day guidance tips to "train hard") and one goes 69 → 70
  (Moderate → High); **nothing crosses the early-deload gate, the Low/Moderate line, or the AI
  low-readiness line**. Do not re-answer this in prose; it is measured.
- **Q-501** (persisted readiness rows drift from the summaries they derive from) and **Q-502** (Body
  Battery's read-through snapshot is a partial day) are queued and **not** blocked — neither is a
  scoring change, so neither needs sign-off.

## Claimed paths
None. This session wrote only docs.

## Do not re-litigate
- **The Recovery Index estimator stays as it is.** Replacing the argmin with a stabilisation point
  correlated *worse* with Oura's own contributor at every tolerance tested (+0.712 shipped vs +0.636
  best alternative). Q-500 is the anchor only.
- **Q-271's headline numbers are dead.** "Never above 50, ever" and "~2.2 points/day" were measured
  over eight days; over 41 the contributor exceeds 50 on 12 days and costs 0.71 points/day. Q-271 has
  been replaced by Q-500 in the backlog and its live cross-references re-pointed — do not resurrect it
  from a stale review copy.
- Q numbers come from the band above, not the backlog's next-free pointer. No migration numbers.
- **Q-272's direction #1 is refuted — do not raise `CHARGE_RATE` first.** The charge window is
  reachable on a median 6.7% of waking samples (0.8% on 2026-08-14), so the rate scales a term that is
  barely active. `REST_THRESHOLD`/the reserve is the lever. Measured, in the Q-502 doc §2.
- **A replay must reproduce the stored values before any counterfactual on it means anything.** That
  check is what made the readiness work trustworthy; on Body Battery it failed (predicted 65/63
  charge/drain against a stored 7/10) and the honest outcome was a partial document rather than a
  tuned constant. Do not skip it because the walk looks simple.
- **Production data moves under you mid-session.** The 2026-08-13 summary was re-rolled while the
  review was being written — `recovery_index_hours` 1.20 → 5.78 as a Q-274 fragment night resolved
  itself. Exactly one of 41 rows, but it changed a headline figure. **Re-pull before quoting, and
  record the pull time.** It also means Q-274's fragment nights *can* self-heal on a re-rollup, which
  nothing had established.
