# 2026-09-27 — four mockups in one sitting, saved to the repo rather than shown in a chat

**Branch:** `docs/four-screen-mockups` · Orchestrator

Four approved-in-principle changes each owed a before/after before any code: `LB-163` (Home's Log
tiles), `LA-136` (Home's sleep line), `RV-213` (Nutrition's empty meal slots) and `RV-166` (merging
walk and run in the cardio hub). The owner asked for them in one sitting, which is also the rule —
splitting them means the same screens get judged three times.

[`docs/design/2026-09-27-four-screen-mockups.html`](../../design/2026-09-27-four-screen-mockups.html) ·
[hosted](https://claude.ai/artifact/U4aypd5Un44whR6exTjWqX)

## Built from source, not from imagination

Each **before** is a recreation from the actual component, at the real 384 px dark viewport, using
the dark tokens copied out of `app/globals.css` rather than approximated:

- **`LB-163`** — the `Log` pill really is `absolute top-0.5 right-0.5` with `min-h-11`
  (`metric-tiles-card.tsx:99`), which is why a 44 px target lands on a 16 px icon; and the tiles are
  a `flex` row, not a grid, which is why three of them leave the right third empty.
- **`LA-136`** — the fabricated line is gone and nothing replaced it; `sleepQualityFeel` is
  collected and unread.
- **`RV-213`** — an empty meal genuinely renders a header `+` *and* a body `+ Add food`
  (`meal-card.tsx:73` and `:105`), two controls for one action.
- **`RV-166`** — **the exception, stated on the page:** its before is rebuilt from the component
  list in `cardio-content.tsx` rather than screenshotted, because the hub needs live data the
  sandbox does not have.

## The gate flips now, and only now

All four move to `Gate: owner`. That was **wrong** before and is right now: the mockup did not
exist, so the next act was to produce one, and producing it is work — which must stay ungated or
nobody is tasked with it. `LB-163` documents this transition, and applying the gate before the
picture exists is the trap this queue keeps falling into.

## `RV-166` is not like the other three

The first three are one component each, no stored data, reversal cost near zero. `RV-166` changes
**what counts as a completed session**, so every past run day becomes completable and adherence,
streaks and compliance all move. That has to be quantified before it merges, not after.

## The convention this establishes

`LB-135` exists because `RV-119`'s approved Home mockup was shown in a session and never saved, so
the approval is recorded and the artefact it approved is not — any session picking it up hits the
same wall. **A mockup is not shown until it is in `docs/design/`.** Noted on `LB-135`; its own lost
artefact still has to be redrawn.

**Not exercised:** a static page, not the app. No component was changed and nothing was rendered on
a device. Gates: `check-backlog-pointers` and `check-doc-links` clean by exit code.

---

## Answered the same day, and the cardio pane was wrong

**Approved:** `LB-163` and `LA-136` — gates cleared, both released to Lane B.
**Declined:** `RV-213`. No reason was given and none is invented in the entry; the finding stays on
the record and the entry is struck, because a declined change is finished rather than parked.

**`RV-166` was redrawn.** The owner asked two questions the first pane could not answer — *"if we
only have run/walk where does Other live? And if you do one; how do you do another?"* — and both
were real defects in the drawing rather than in the idea.

The mistake was conflating two separate things. The **prescription** is today's plan and there is
one of it; the **activity log** is what was actually done and there can be any number, of any kind.
The first pane showed the prescription card *replacing* the modality picker, which deleted `Other`
and left no way to log a second activity. Merging walk and run applies to the prescription only.

The revision shows two states — before training and after a walk followed by a bike ride — with the
picker present and unchanged in both, and a **Logged today** list where the activity that satisfied
the prescription carries a `Plan` chip and the second carries `Extra`.

**One edge is now explicit rather than assumed.** His rule was "one or the other", so `Run` and
`Walk` satisfy the prescription and `Other` does not: a 42-minute bike ride logs as Extra and leaves
the run To do. That is followed literally and flagged on the page as possibly wrong for him — if a
hard ride should count, the fix is a per-activity "count this as today's cardio" action, not a
blanket rule.
