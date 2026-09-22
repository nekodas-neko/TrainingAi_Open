# 2026-09-22 — `chore/or-124-batch-device-checks` (OR-124)

**Orchestrator.** Intended as the device-check batching pass that OR-122 deferred. It turned into
two other things, because the batching pass is forbidden and the top of the READY list was stale.

## The batching pass does not happen, and should not have been promised

CLAUDE.md:118: *"Assign batches when an entry is next touched, not in a bulk pass."* OR-122 closed
by naming a bulk batching sweep as the next pass. That was wrong against a standing rule, and the
rule is right: a batch decided without re-reading the entry is a grouping made from a 150-character
residue, and it goes stale silently where nobody re-reads it.

**What the owner actually wanted from it is a view, not a field.** `node scripts/next-item.js
--sittings` now prints every entry owing a device check, grouped by primary domain tag, with each
one's lane and existing batch. It counts both shapes — a `Verify: device` **and** a `Keep:` naming
the device — because BF-90 found eleven entries writing the same debt in both places, so keying on
either alone undercounts.

Measured on this commit: **104 owed, 27 already batched, 77 loose.** app-shell 27 · nutrition 19 ·
workouts 15 · devices 13 · platform 9 · readiness 7 · body 5 · sleep 4 · activity 2 · heart-rate 2 ·
cardio 1.

Domain tag is the proxy for screen: already on every heading, mechanical, and it freezes no
judgement into the file. The view cannot go stale. A `Batch:` written today could.

**The count corrects twice.** OR-122 said 47, then 62. Both were low — the first predated review
sweep 52, and the second used a narrower residue test and skipped batched entries.

## TN-59 was at the top of READY with a superseded premise

Tuning filed TN-59 on the morning of 2026-09-22: `next-item.js` parked any entry containing the
no-entry glyph, 28 entries were parked that way, and LB-124 had been filed and parked the same
morning, taking Lane B's READY list to zero. It specified a Custom Rules check with a 28-entry
shrink-only baseline.

**#1390 landed hours later and narrowed the detector. Entries parked by a prose marker alone: 0.**
An implementer taking the top of the list would have built a check against a backlog that no longer
exists, and baselined it at a number three weeks out of date.

Reconciled in place rather than removed, because the preventive half survives: someone can still
write `<no-entry sign> blocked: <reason>` in prose where a `Gate:` belongs. That check is much
smaller — **baseline 0**, no triage to precede it, the same shape as
`check-aest-midnight-timezone.js`. The 2026-09-22 morning record is kept below a rule, marked as a
record.

One claim in the reconciliation was written and then corrected before pushing: it asserted that the
new text parks TN-59 under the narrowed rule. Running the tool says it does not — the caution
carries no *block* within 40 characters of the glyph. Asserting a tool's output without running it,
inside an entry about a tool's output, is the same mistake in miniature.

## Worth carrying

**TN-59 and OR-122 are one finding, reached independently on the same day from opposite ends** —
Tuning from having swept 17 markers by hand and watched a new one arrive; the Orchestrator from Lane
B having nothing to start. Neither session saw the other. The common cause is `LA-49`, which
measured the whole thing on 2026-09-01, specified the fix, and sat for three weeks because it quotes
the glyph as evidence and was parked by the bug it describes.

**A self-parking finding does not stay found. It gets re-found, and each re-finding pays the
investigation again.** That is a better argument for the check TN-59 still proposes than the count
it was written against.

## Not done

- **No `Batch:` fields were written.** They get assigned when each entry is next touched, per the
  rule. `--sittings` is what makes that cheap — an implementer touching an entry can see in one
  command which sitting it belongs with.
- `--sittings` has **no test**. It is a read-only view over a parser the existing tests already
  cover, and its output is advisory by construction; a test pinning its grouping would pin the
  domain tags rather than the logic.
