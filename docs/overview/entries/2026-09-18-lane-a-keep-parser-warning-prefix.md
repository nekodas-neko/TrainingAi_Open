# 2026-09-18 — LA-120: the queue tool called four shipped entries unstarted, and LA-76 lost the gate that blocks it

**Branch:** `lane-a/keep-parser-warning-prefix` · **Lane A** · one PR · no migration · unversioned

Two defects in the same surface — what `node scripts/next-item.js --lane A` says you can start —
found by using it rather than by reading it.

## How they were found

`next-item.js` offered **LA-76** as Lane A's next item. Re-verifying it against `main` (the protocol
step before implementing) turned up its own instruction: *"put that to the owner before writing the
migration."* An entry that tells you to stop was at the top of a list whose entire job is to answer
"what can I start now". The same run offered **LA-118** at #4 — whose code I had shipped that
morning.

## Defect 1 — a Keep prefixed with ⚠ did not parse

`keepFromLines` matched `- **Keep:`, `**Keep:`, and `- **Keep — …:`, but not `- **⚠ Keep:`. Four real
entries write that form — TN-49's three and LA-118's one — and all four were invisible to it, so they
kept their original (high) priority and read as unstarted work.

That is precisely the failure `scripts/lib/keep.js` was written to end, for the third time: the file's
own history records it happening to the colon requirement (Q-420) and then to the em-dash form (TN-3a
and TN-4 at #1 and #2 of READY). Each time the parser was narrow in a way nobody noticed until a
shipped entry was offered as buildable.

**Measured before widening, because that file's comments argue the case both ways** — anchoring too
tightly would "silently un-park genuinely blocked work, which is worse than the bug". Across all 144
`Keep:` bullets in the backlog, **140 matched and 4 did not, and all four were that one shape.** So
the widening is `[^\w\n]{0,3}` between the asterisks and the word: **non-word only**, which is what
keeps the two documented false positives still refused — Q-420's `**Keep the stored field on 1–10**`
and any prose `The Keep:` both contain a letter before the word and still return null. Both are
asserted.

After the fix: LA-118 moves from READY to KEEP, and Lane A's READY list drops from 12 to 11.

## Defect 2 — LA-76's gate was removed for the right reason and never replaced

The owner settled LA-76's **rule** on 2026-09-14 (*"A deload week or session should still count as an
exercise so it wont decay cats"*), and the `Gate: owner` was removed on that basis. Correct as far as
it went. What the decision did not settle is the question the entry's own ⚠ raises: whether a deload
span becomes **first-class stored state**, which is what a dated `program_phases` interval commits to
and what the migration would build.

So the gate is back, saying which question it is waiting on — a different one from the answered one.
LA-76 now parks, and READY drops from 11 to 10.

**Written canonically rather than by widening a second regex.** The first attempt wrote
``- **`Gate: owner`, and it is…`` and the tool still called the entry READY: `next-item.js:76` anchors
the top-level gate to `^\s*[-*]\s*\*{0,2}Gate:`, and a backtick between the asterisks and the word
defeats it. Measured the same way — across the whole file, exactly **two** lines look like a Gate
field and are not parsed as one: mine, and a *continuation* line in BF-80 which the Keep path already
reads correctly (BF-80 parks). One instance is not a population, so the bullet was rewritten to the
form the parser expects instead of loosening a second matcher on a single example.

## Verification

`scripts/__tests__/backlog-keep-residue.test.ts`, three new cases. Against `keep.js` as it stands on
`main`, **exactly one fails** — the ⚠ form — and the two refusal controls pass, as they must: the
original was stricter, so a test that only asserted refusals would prove nothing about this change.

The real check is the tool's own output, which is in the diff's effect rather than in an assertion:
READY 12 → 10, KEEP 74 → 75, one entry parked.

## Not exercised

- **The S25 device.** Repository tooling and a backlog edit; nothing ships to the app.
- **Whether the other 140 Keeps still classify identically.** The widening can only match *more*, and
  what it newly matches is bounded by the non-word prefix — but no before/after diff of all 359
  entries' buckets was taken, only the READY and KEEP counts.
- **LA-76 itself**, which is now the owner's call and is the reason this exists.
