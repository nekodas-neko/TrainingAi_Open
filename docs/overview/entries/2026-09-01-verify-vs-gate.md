# 2026-09-01 · Lane A — a gate that does not gate (BF-90)

Branch `lane-a/verify-vs-gate`. Tooling and a field sweep. No migration, no runtime code, no device.

## The owner's question, and the answer he did not expect

*"is there anything we can do to lower that? with our e2e and sentry etc cant you do the testing
thats needed?"* — asked about the number of queued items waiting on him.

The assumption was that his decisions are the bottleneck. They are **10 of 41**. Device verification
is the other 31, and eleven of those thirty-one sat on entries whose own headings said *"shipped;
device check owed"*. They block nothing. But `Gate:` **parks** an entry, so `next-item.js` filed
finished work under PARKED beside work that genuinely cannot start.

## `Gate: device` meant two opposite things, and the docs had picked the wrong one

The protocol block said, in bold: *"`Gate: device` means SHIPPED and awaiting a device check — never
'will need one when built'."* That made it the one gate that does not gate. Meanwhile PS-8 carries
*"Phase 0 cannot start without the physical R09 in hand"* and PS-11 needs the ring worn overnight —
real blocks, written as gates, in direct contradiction of the documented rule.

So the field genuinely carried both meanings and the documentation had committed to the half that
should not park.

`Verify: owner` / `Verify: device` is the second meaning, given its own field and its own **VERIFY**
section. `Gate:` now means blocked, uniformly — which is what the word says, and what makes the
parking behaviour follow from the field name instead of from a rule nobody re-reads.

## The entry said eleven. The existing tooling found six more.

BF-90 identified its eleven by their headings. Running `keepKind` — the classifier OR-100 shipped
this morning — over every remaining `Gate: device` found **six more** whose own `Keep:` residue is a
check rather than a build: BF-76, BF-53, BF-26, BF-27, TN-13, Q-93. Seventeen converted, not eleven,
and the extra six came from a rule already in the repo rather than from a judgement call.

`check-backlog-pointers.js` now reports any `Gate: device` whose `Keep:` reads as a check, using
that same classifier — advisory, never failing, in the posture OR-100 established. An empty list is
today's real state rather than an untested branch.

## The mutation that mattered

Four mutations, three killed immediately. The one that survived was **moving the `Verify` check
above the park test** — and it survived because no entry in the queue happens to carry both a
`Verify:` and a real block, so the rule that stops a `Verify:` rescuing blocked work was completely
untested.

That is why the classification came out of `next-item.js` and into `scripts/lib/queue-buckets.js`:
one pure `bucketFor(entry, reasons)` with the ordering argument written above it, exercised against
synthetic entries the real queue does not contain. Both surviving mutations die now.

A second test bug came out of the same pass. `expect(parked).not.toContain('BF-53')` failed while
BF-53 was correctly in VERIFY — another entry's `Needs: BF-53` line prints inside PARKED, so the id
appeared there without the entry doing so. The assertion was wrong, not the code. It matches at the
start of a row now.

## The bigger half, measured and deliberately not shipped (LA-49)

`next-item.js` also parks on any `⛔` in an entry body. **34 entries contain one. Seven use it to
mean blocked** — and one of those seven is struck through and marked `✅ CLEARED`. The other 27 use
it as emphasis: *"⛔ Do NOT impute the check-in on unlogged days"*. So the false-park count from this
one glyph is larger than the entire `Gate:` problem BF-90 was opened for.

Narrowing the detector to the file's own documented `⛔ blocked:` form was measured: 27 entries leave
PARKED, **16 of them into READY**. And that is why it is not in this PR. The 16 include `BF-14`,
whose heading opens *"❌ REFUTED 2026-08-24"*, and `Q-49`, marked 🔴. They are mis-filed today, held
out of sight by a `⛔` and nothing else; narrowing the detector would move them to the top of the
work list rather than fix them. Trading a section nobody reads for a section an implementer starts
from is the worse failure.

Filed as **LA-49** with the measurement and the required order: triage the 16 first, then narrow the
detector.

One `⛔` was corrected here, because it needs no judgement: TN-13's sat on a question its own
sentence calls *"ASKED AND ANSWERED 2026-08-31. No. Do not re-open."* An answered question was
parking a shipped entry.

## Result

PARKED 114 → 97. VERIFY 17. READY and KEEP unchanged — nothing was mis-promoted. The count the owner
was given is now honest: **10 items wait on him**, seventeen wait on a phone, and the rest are work.

Verified by `pnpm check:rules` (**Ran 67 of 67**) and the full suite. **Not exercised:** nothing
runtime changed, so there is no device surface here.
