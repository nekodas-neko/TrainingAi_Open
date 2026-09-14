# 2026-09-14 — the app-shell pass, and fifteen entries that had been finished for days

**Branch:** `chore/or-113-shell-pass` · backlog + one queue-tool check. No product code.

## The finding worth the sitting: a verification and a `Keep:` ten lines apart

Nineteen entries carried a `✅ VERIFIED ON THE S25` line **and** a `Keep:` still claiming that device
check was owed. They were spread across all three device passes — nutrition, workouts, app shell —
and none of them is wrong when read on its own. Recording the owner's answer and striking the residue
are two edits; only the first one feels like progress.

The cost was that `next-item.js` kept printing finished work as debt, which is the exact failure
`Keep:` was introduced to fix (OR-100) wearing the other hat.

**Fifteen were fully done and left the queue. Four owed something else and were narrowed:**

| entry | what is genuinely left |
|---|---|
| BF-145 | ② the sheet question — a decision, not an implementation |
| BF-109 | (a) a real barcode scan of `9350167000490`; the camera is the part no harness reaches |
| Q-531 | the drain → re-sync → verify walk; only findability was checked |
| Q-187 | the design question — spread vs next-meal-only, which only use can settle |

Three removals kept a `>` note rather than vanishing, on the rule that a note survives where the entry
held knowledge nothing else pins: **BF-76** (the `vh` hypothesis is not the safe-area mechanism — a
bottom sheet is `fixed inset-x-0 bottom-0`), **BF-57** (`shared-meal` carries the recipe and works
cross-account; `meal-id` is a 22-character pointer that only resolves for its owner, and six of seven
label styles are pointers), **BF-46** (a `fetch()` of a `data:` URL is governed by `connect-src`).

**It is checked now.** `keepIsSettled` in `scripts/lib/keep-kind.js`, six tests, advisory in
`check-backlog-pointers`. It is **suppressed by the word DONE** in the residue — the four narrowed
entries above all say which half is done, and a rule that fires on the entries someone handled
correctly is a rule people scroll past.

## A failure filed under the wrong entry for a day

**BF-100's device failure was written into RV-36's entry.** For a day the entry that FAILED read as
shipped-and-awaiting-a-look, and the entry that PASSED carried a failure note contradicting its own
verification a few lines lower. Moved. Both are about the same hook, which is what made it invisible
from either one alone.

BF-100's `Verify:` now says **start with `/more`**, which is where it failed, and carries the second
requirement the owner named: **back from a tab with nothing to pop should land on Home, not exit** —
inherited from Q-93-followup, which asked the same thing for `/health/day` and has left the queue.

## Two gates that were never the owner's

- **BF-110** — `Gate: device` parked it while the next step it asks for is **one line of code**: log
  the viewport a second time ~500 ms into the same resume, to separate a genuinely stuck WebView
  viewport (native fix) from a measurement taken too early (render-gate fix). The device is the
  verdict on a *fix*, which is a `Verify:` after something ships. The owner sat on this item in two
  device passes with nothing they could usefully do.
- **Q-1b** — `Gate: owner` against the entry's own instruction *"Do not re-put this to the owner"*.
  Settled twice already; the field kept it printing in every owner-decision sweep. `Keep:` alone
  holds it out of the work list.

Both are the defect **PS-35b** names: a gate that prose scopes to one paragraph parks the whole entry,
and the runner cannot see the scoping.

## Three answers

- **BF-126 — build the artwork.** *"Yes we need to create artwork for these."* Two things the answer
  did not settle are now written into the entry: the **brief** (~12 assets, against nine glyphs
  covering the three ladders today) and the **32 px constraint**, which is a real risk to the answer
  rather than a footnote — an emoji is drawn to read at that size and a detailed sprite is not.
  **Ship one tier and compare it against its glyph before commissioning twelve.** The glyph map stays
  as the fallback; a missing asset must not leave an empty tier.
- **Q-147 — removed, and no number was ever taken.** *"Seems good now."* The entry existed because
  cold app start had never been measured, and it closes on a judgement rather than the measurement it
  asked for. That is recorded plainly: **there is no cold-start baseline in this repo**, so a future
  regression has nothing to be compared against.
- **Q-51 — the premise softened.** *"Its mostly fine; I'd still like it to be faster if possible."*
  This entry was placed high because it was the owner's **stated felt pain**. It is now a want, and
  the placement should follow. Its own instruction to measure before refactoring is more binding, not
  less: a large refactor is a poor trade against "mostly fine".

Q-147 and Q-51 together also prop up Q-1b's hold, which says to reopen only if *"the app starts
feeling slow to open"*.

## Result

Queue **347 → 332**. Backlog **21,598 → 21,095 lines**, the largest single drop recorded — the
baseline is ratcheted down rather than left as slack.

`check-backlog-pointers` clean on 332 entries · `pnpm check:rules` **Ran 74 of 74** · `keep-kind`
15 tests green.

**Surfaces not exercised:** none apply — backlog and one Node check script. No product code, so
nothing reaches the APK from this PR.
