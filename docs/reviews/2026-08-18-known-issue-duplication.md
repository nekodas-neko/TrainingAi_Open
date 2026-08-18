# Review — a Known Issue in two lists at once, and the check that now prevents it

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 35** · **Finding:** Q-553 (filed and fixed here)

## Why this lens

Sweep 34's baton entry set the direction: **audit prose that duplicates a machine-checked fact.**
Three instances of the pattern had accumulated (Q-491, Q-492, Q-552). This sweep looked for the same
shape somewhere with *no* check at all, and the obvious candidate is the pair of Known-Issue lists:
the live one in `projectOverview.md` and the archive in `docs/overview/known-issues-resolved.md`.

`CLAUDE.md` is explicit about the invariant: *"Striking a Known Issue means MOVING it … Cut the entry
whole, append it to the archive, **leave nothing behind**."* Nothing enforced it.

## What was found

**Two entries were in both lists**, each ~30–70 lines, each the result of the same two-part mistake:
the move was performed as a **copy**, and it was performed **early**.

### Q-139 — `🔴 OPEN` in the live list, `✅ fixed` in the archive, for ten days

| | Said |
|---|---|
| `projectOverview.md:3309` | `🔴 Q-139 — resolveDsToMs compresses ring time by up to 18× during a backlog drain (found 2026-08-07, **OPEN**)` — 69 lines describing the bug as unfixed |
| `known-issues-resolved.md:227` | `✅ Ring time no longer compresses during a history drain (Q-139, **fixed 2026-08-08, v1.270.25**)` |

Every session's mandated orientation read has shown a **red, highest-severity, open** issue for a bug
fixed ten days earlier.

**Both halves are genuinely fixed — verified in code, not taken from the archive's word.**
`resolveDsToMs` applies the fixed 100 ms/ds slope with a per-epoch p10 offset; and the sibling gap the
live row called *"worth closing as a backstop"* is closed too —
`packages/shared/src/health/step-estimate.ts:176` gates **model** windows through
`isPlausibleStepWindow`, with a comment naming Q-139 and saying *"It used to apply to live windows
only."*

### Q-81 — a byte-identical 31-line entry in both files

Same heading, same body, both marked ✅. A pure copy.

### Both were archived while something was still owed

This is the second half of the mistake and it is easy to miss. `CLAUDE.md`: *"Only move an entry when
nothing is still owed: no open work, no pending owner or device check."*

- **Q-139** — *"Not verified on device — the on-device consequence only shows after the next real drain."*
- **Q-81** — *"⚠️ Not verified — whether it fits on the owner's real data … Worth re-checking after a day."*

So neither belonged in the archive yet. **Resolution applied here: cut the premature archive copies,
keep the live entries** — which is the conservative direction, since the live list is what every
session reads and it is where an owed check belongs. Q-81's archive copy was identical, so nothing was
lost; Q-139's unique material (the p10 reasoning, the fix-forward decision, the journal link) was
folded into the live entry before its archive copy was cut. The stale 69-line `🔴 OPEN` body was
replaced with a compact `⚠️ FIXED, not verified on device` entry.

`docs/domains/activity/README.md` carried the same stale claim — `🔴 … (found 2026-08-07, queued,
**needs one owner decision**)` — when the owner decision had been made and recorded. Updated.

## The check, and what running it taught

`scripts/check-known-issue-duplication.js`, now step **41 of 41** in Custom Rules. It compares the two
files' `###` headings and fails on any Q number heading an entry in both.

**Its first version reported four and only two were real** — the same over-report this run has hit
repeatedly, this time in a script I had just written to catch over-reporting:

| Reported | Real? | Why not |
|---|---|---|
| Q-139 | ✅ | |
| Q-81 | ✅ | |
| Q-76 | ❌ | The *archive* heading is about **Q-75** and mentions Q-76 in passing (`"… (Q-75, …) — Q-76 fixed 2026-08-05"`). |
| Q-69 | ❌ | The *live* heading is a **batch range**, `(Q-63…Q-69)`, legitimately spanning one member since fixed. |

Two narrowings followed, both written into the script's own header so the next reader inherits the
reasoning rather than the conclusion: **a heading's identity is its first Q number**, and **range
headings are skipped** (a stale range wants a human splitting the batch, not a red build).

An earlier, cruder pass over the domain indexes had also flagged Q-107 — whose only appearance in the
archive is a note **retracting** a link to it — and flagged `sleep` and `devices` for Q-139, where both
merely *reference* the fix and `devices` correctly calls it *"already-shipped"*. Four apparent sites
became one.

## Why this matters more than a tidy-up

The live Known-Issues list is the one artefact `CLAUDE.md` requires **every** session to read before it
may start work. A false `🔴 OPEN` there is not a documentation blemish — it is a standing instruction
to five concurrent agents to treat a working subsystem as broken, or to fix it again. Ten days of that
went unnoticed because the two lists had no relationship anything could check.

## Not exercised

Static reconciliation against the repository. The **claim that both halves of Q-139 are fixed was
verified in source**, not on device — and Q-139's own outstanding item is precisely an on-device check
after the next history drain, which this harness cannot perform. Q-81's outstanding item (does the
model fit the owner's real data) needs production, also not done here.
