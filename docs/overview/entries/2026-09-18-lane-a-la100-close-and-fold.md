# 2026-09-18 — LA-100 closed by running the sweep it said was impossible, and 40 entries folded

**Branch:** `lane-a/la100-close-and-fold` · **Lane A** · docs-only · no code, no migration ·
unversioned

## Why this was picked up at all

LA-100 sits on a standing do-not-take list that a scheduled routine carries. That list was compiled
**2026-09-12**; OR-119 resolved LA-100's blocker on **2026-09-17**. The exclusion was stale, and the
entry's own text said so outright — *"What stays open is smaller than the entry and **is not the
owner's**"*, with `Gate: owner` explicitly removed. Checking the entry rather than trusting the list
is the whole reason this was startable.

## What LA-100 claimed, and why none of it is true any more

**Claim 1 — "there is nowhere obvious to fold them TO",** because the batched history files are
era-based (`history-newest.md`, `-recent`, `-newer`, `-past`) while entries are dated. Measured:
**28 of 32 history files are dated**, and `scripts/fold-journal-entries.js` has been writing
`history-<date>-folded-N.md` since LA-80. Only those four carry the old scheme, and the entry itself
calls them frozen. The convention the owner was being asked to choose had already been chosen by
precedent and by the tool.

**Claim 2 — the file-count ceiling is "BLOCKING, not blocking-ish"** and every lane's next PR would
fail CI. It is an **advisory note** now (*"Not a failure; sweep it when convenient"*), so the
+1-per-PR treadmill it describes cannot happen.

Both were already recorded as stale by OR-119. What was missing was the last step: **the entry was
still in the queue**, which the protocol forbids for finished work, so every lane kept being offered
it.

## What shipped

**The sweep, run rather than described.** `node scripts/fold-journal-entries.js` — dry-run first —
folded **40 entries into `history-2026-09-18-folded-1.md`**, rewrote citations in four files
(`docs/domains/heart-rate/README.md`, `docs/domains/readiness/README.md`,
`docs/implementation-backlog.md`, `projectOverview.md`), and held back **5** an agent baton cites,
which is the tool's one deliberate refusal: rewriting those means one lane writing into another's
live state file. `docs/overview/entries/` went **80 → 40** files, 50 foldable → 21.

`check-doc-links` clean on **816 files**, run after the fold as the script's own output instructs —
not reasoned about, which is the trap its header documents: a link inside a folded entry loses a
directory level in both `../` and `../../` forms.

**LA-100 removed from the queue** (62 lines), and its one genuine residual moved to
[`docs/overview/entries/README.md`](README.md) rather than deleted: whether the four era-named files
are ever renamed. Nothing cites them by scheme and nothing new lands in them, so the answer is
probably never — it is a judgement for whoever next touches them, which is why it belongs next to the
convention and not in a queue.

## Verification

Custom Rules **75 of 75** — and it caught something on the way: removing 62 lines from the backlog
failed `Orientation docs stay within their baselines` until `pnpm fix:baselines` was re-run. The
ratchet is shrink-only, so a *reduction* moves the baseline down and a stale one fails. Worth knowing
because the instinct on seeing that name is to assume the document grew.

`check-doc-links` OK (816) · `check-backlog-pointers` OK (358 entries).

## Not exercised

- **The S25 device.** Docs only; nothing reaches the app.
- **A second sweep to get under the 20-file threshold.** 21 foldable remain and the note is advisory.
  Folding again immediately would take this week's entries, which are the live reading window — the
  sweep is oldest-first by design and there is no value in emptying the window.
- **The four era-named files themselves.** Untouched, as intended.
