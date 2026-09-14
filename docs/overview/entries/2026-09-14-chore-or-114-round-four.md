# 2026-09-14 — round four: the ring key is backed up, and eleven entries closed

**Branch:** `chore/or-114-round-four` · backlog only. No product code.

## The one that mattered

**Q-537 is done — the Oura ring key is backed up.** It was the only irreversible gap in the project:
the ring runs on our own auth key, that key lived in one app's storage on one phone, and an uninstall
destroys it with no recovery from the repo, the server or any log. The entry is removed; **the
warning is not**, and is kept as a note beside where the entry was.

## Eleven entries left the queue

BF-136, BF-53, BF-71, LA-45, BF-108, BF-119, LB-36, LA-52, Q-537, BF-27, BF-34.

**Two groupings paid off exactly as designed.** One walk answered LB-36 and LA-52 together — the
owner asked *"How to check this?"* of LA-52 and the honest answer is that it could not be checked
alone, which is why the two were put on one walk. One back-press answered BF-27 and BF-34, and
archived a `projectOverview.md` row covering **four** entries across three versions.

**BF-107 is a conditional close and says so.** *"Treat this as complete for now and if I re-raise it
we know its not."* Neither the offline dash nor the dash-then-number fill was observed, so a repeat
report is a regression against an unverified fix, not a new bug.

## Four decisions

- **LA-76 — a deload must not decay the collection.** *"A deload week or session should still count
  as an 'excercise' so it wont decay cats."* Broader than the question asked: it covers a deload
  **session**, and a session is already dated (`workout_sessions.phase_type`), so **half of this
  ships with no schema change**. Do that half first; only the phase interval needs the migration.
- **PS-35a — delete the five redirect pages, with a condition.** *"If its not accessible via the APK
  and is needed; then make sure there is a way to access it from APK."* Not a blanket delete: where
  the only path to a needed screen is that page, it gets a real entry point before anything is
  removed.
- **Q-111 — build the scale battery chip.** The stated need is **advance warning**, not a live
  reading, which is what the scale can actually give. Native, so it needs an APK.
- **BF-105 — a spoken cue, not a second chime.** *"No we need something like a tone saying
  'fast'/'slow' or so."* That rules out a distinct-tone-per-phase as well, which was the cheaper
  option this entry left open.

## Three findings the checklist produced by accident

- **Q-34 changed shape.** *"The sleep staging data is still not accessible from the sleep tile."*
  The entry is about staging *quality*; this is a **reachability** failure. Start by reading whether
  `sleep_sessions` holds stage rows at all — a pipeline gap wearing a UI complaint will not be fixed
  on the destination screen.
- **Q-529 was answered and refused.** The provisional marking shipped and was seen; what the owner
  wants is the score **right on open**, which is sync latency, not labelling. Three candidate causes
  (drain, rollup, screen fetch) and no measurement yet of which dominates.
- **TN-13's check was asked with the wrong location — my error, now traced.** They were sent to
  Health and the tile is on **Home**, labelled `Heart Rate`, in the score chip row. The mistake
  exposed something real: Health's own Resting HR tile shows a bare number while Home's shows the
  same signal with a delta against baseline. Two surfaces for one metric, disagreeing about context.

## One new entry

**OR-115** — the admin surface, from the owner declining to stage a ring re-sync for Q-533: *"I'd
like to re-organize all the buttons and options we have in the admin section."* Filed with the
instruction not to start by deleting: two of those buttons are the only way out of a real failure and
are pressed once a year, so **rarity is not disuse**, and hide beats delete for anything recoverable.

## Result

Queue **332 → 322**. `Verify: device` **31 → 22**. Backlog **21,087 → 20,952**; `projectOverview.md`
**10,881 → 10,846**, two rows archived. Both baselines ratcheted.

`check-backlog-pointers` clean on 322 entries · `pnpm check:rules` **Ran 74 of 74**.

**Surfaces not exercised:** none apply — backlog only.
