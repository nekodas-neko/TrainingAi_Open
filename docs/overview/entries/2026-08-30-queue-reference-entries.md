# 2026-08-30 — `feat/queue-reference-entries` (LB-22) — a map entry stops heading the work list

**Lane B · test-only tooling.** `scripts/`, the queue file, and the two docs that describe the
field. No product code.

The queue holds two kinds of thing. Most rows are work; a few are **maps that other entries read** —
BF-28 carries the twelve artboards and the three parity rules six entries follow, and BF-11 is the
spec its eight phases read. They belong in the queue: deleting them would scatter rules that six
entries would then re-derive. But they said so only in prose, and `next-item.js` had no notion of
it, so **BF-28 printed as READY #1** under a header that reads *"top of the list is next"*.

## The decision the entry said to make first

LB-22 asked whether the marker should be a **field** or a grep of two English phrases, and named the
argument itself: `Lane:`, `Needs:` and `Gate:` are fields *because* prose-detection loses. The
codebase already agrees in a place the entry did not cite — `next-item.js` treats the `⛔` prose
marker as an **unmigrated** state and reports it as such, which is the same conclusion reached once
already.

So it is `- **Reference:** <why>`, parsed by `scripts/lib/reference.js` beside `keep.js` and
`lane.js`, and enforced by `check-backlog-pointers.js`: an entry may keep the sentence for its
detail, but the field has to be there beside it. Without that ratchet the next map entry gets
written with a third phrasing and the tool silently mis-sorts it again.

## The ordering question, which was not in the entry

A Reference is **checked last**, after gates, unmet `Needs:` and `Keep:`. Those three say something
is **owed**; `Reference:` only says there is nothing to **build**.

That distinction is not theoretical — it is BF-11. Its eight phases shipped and the S25 walk it
defines did not, so it carries a `Keep:`. A first cut checked `reference` first and moved BF-11 out
of KEEP, **hiding a device obligation behind "not a work item"**. Reference now cannot hide anything:
BF-11 stays in KEEP where its residue is visible, and BF-28 — which owes nothing — is the only
REFERENCE row.

## The checker caught its own weakness immediately

The first `hasProseMarker` was a substring match and flagged **LB-22 itself** — the entry that
*proposes* the field quotes both markers while describing them. An entry discussing the convention is
not claiming it, and a checker that cannot tell those apart is precisely the prose-detection failure
the field exists to end.

It is anchored at the start of a bullet now. Both real cases write it there
(`- **⚑ Not implementable on its own.**`, `- **Not a work item.**`); a quotation mid-sentence does
not match. Six unit tests pin it, including the two LB-22 shapes that produced the false positive.

## Driven, not inspected

Deleting BF-28's `Reference:` field does two things together, which is the whole claim:
`check-backlog-pointers.js` **fails** with the message naming the fix, and `next-item.js` puts BF-28
back at **READY #1**. Restoring it returns the checker to OK and READY to 46 with BF-28 in a
REFERENCE section of one.

`pnpm check:rules` **Ran 61 of 61**, all passed.

## Lane

`scripts/**` is reached by neither half of the path rule, and LB-22 said so — *"arguably the
Orchestrator's the way LB-12's sweep is. Decide before starting."* Taken by **Lane B** under the
ambiguity rule: Lane B filed it, and Lane B is the tool's user. LB-12 is genuinely different and
stays the Orchestrator's — that is a sweep over *entry content*, this is the tool's output shape.

## Not exercised

- No product code, so nothing to verify on device.
- Only two entries carry the marker today, so the field has been exercised on a population of two.
  The ratchet is what covers the third.
