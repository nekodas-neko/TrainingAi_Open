# 2026-09-25 — a shipped entry kept printing as READY, because a `##` inside it ended it

Lane B. `scripts/lib/mid-entry-heading.js` (new), `scripts/check-backlog-pointers.js`, one test file,
four headings demoted in `docs/implementation-backlog.md`.

## The symptom, and why it was not a typo

`BF-165` shipped in the `back-gesture-sitting` batch, with a `Verify: device` bullet added in the same
PR. It kept printing as **READY**. Its batch-mate `DV-2`, given a byte-identical bullet, moved to
VERIFY correctly.

The parser was reading BF-165's field. It was not reading BF-165. The entry carries two sections
written as `## ` headings — a retraction notice and a root-cause write-up — and **a `## ` ends an
entry**, in `next-item.js` and in `check-backlog-pointers.js` alike. Everything below the first one
belonged to no entry: the whole root-cause analysis, the device reproduction, the fix constraints, and
both of the fields that were supposed to take it out of the lane.

So an implementer opening the queue was told to build an entry that had shipped, and the device check
it owed was tracked nowhere.

## The rule cannot be "no `##` inside the queue"

The truncation is deliberate and load-bearing. The queue carries real **section boundaries** between
batches of entries — *"Owner request, 2026-08-25"*, *"Nutrition focus — the owner's priority"* — and a
field written under one of those belongs to no entry rather than to the last entry above it. The
checker's own comment says so.

So a check has to tell a boundary from a mis-levelled sub-heading, and the discriminator is **what
follows, not the wording**: a boundary is followed by prose and then a `### ` entry, while a truncated
entry's own FIELD bullets sit under one. Measured across the whole queue: **seven** mid-entry `## `
headings, **six** genuine boundaries with no field under them, **one** — BF-165's — orphaning two.

One detail is load-bearing and the first version of the scan got it wrong: it must scan to the next
`### `, not to the next heading. BF-165 has *two* `## ` sub-headings and its orphans sit after the
second, so a scan that stopped at the first reported the entry clean.

## What shipped

- `scripts/lib/mid-entry-heading.js` — the classifier, extracted rather than left inline for the
  reason `decorated-field.js` records: the shapes that must **not** trip it are the point, and a check
  that flagged six legitimate boundaries would be deleted rather than obeyed. Five unit cases,
  mutation-tested two ways (stopping at the next heading → 3 fail; matching any bullet rather than a
  field → 1 fail).
- `check-backlog-pointers.js` fails on it, naming the heading and each orphaned field. It is the third
  member of a family that already existed: a field written inline, a field prefixed with a warning
  glyph, and now a field below a mis-levelled heading — all three silently ignored, all three caught.
- Four headings demoted to `#### ` — BF-165's two, plus TN-30's and TN-31's, which carry no fields
  today and would have swallowed the next one added.
- The protocol at the top of the backlog now states the rule where someone writing an entry will
  read it.

## What it changed in the queue

`BF-165` parses its `Verify: device` and `Keep:` and leaves READY. Lane B's READY list goes **2 → 1**.

## Not exercised

Nothing here touches the app. No device check, no version bump — this is queue tooling and the
documents it reads.
