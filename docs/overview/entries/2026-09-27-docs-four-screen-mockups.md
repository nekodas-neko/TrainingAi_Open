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

## `RV-213`'s reason turns a refusal into a rule

Asked why, the owner said: *"I like the original look; it shows the grouping nicely with the space."*
So the ~150 px the finding measured as waste is **doing work** — it is what separates one meal from
the next. Recorded on the entry as a **design principle for Nutrition**, not a one-off no: a future
sweep measuring blank space on the diary will reach the same finding, and should stop at that line
rather than re-file it.

## `RV-166` gained a walk flow, and it depends on a change shipped the same morning

He added: *"I will mostly do my treadmill walk; so when I click walk, I'd like to be able set a
guided walk — or just a treadmill walk + time. Or perhaps it could even say x amount of minutes in
x zone rate to count as complete."* Both halves are taken — the card states the criterion in zone
terms with live progress, and `Walk it` offers a guided walk or a treadmill walk with duration
chips. Drawn as **RV-166b** on the mockup.

**It only works because of `TN-78`, shipped the same day in #1774.** The moderate floor moved from
60% to 40% of heart-rate reserve. At 60% the floor was **134 bpm**, hit on 3 of 31 days — a
treadmill walk earned zero zone minutes, so a zone-worded target would have been unreachable on
foot. At 40% it is **107 bpm**, hit on 24 of 31. Neither change makes sense alone, and an
implementer taking `RV-166` without `TN-78` would ship a target the owner cannot meet by walking.

**One small decision left open:** whether a treadmill walk logged with no heart-rate data counts.
Recommended on the mockup — count the minutes, mark the day `estimated`, because refusing to
complete a walk he actually did is the worse failure. Not yet answered.

## The last open question, and the convention it reuses

A treadmill walk with **no heart-rate data does count** — the logged minutes go toward the target
and the day is marked `estimated`. Refusing to complete a walk he actually did is the worse failure.

**The app already models this distinction**, so it is reuse rather than a new mechanism:
`packages/shared/src/health/observed-hr.ts:125` carries `source: 'observed' | 'estimated'` on
`MaxHrResolution`, and `body-battery-inputs.ts` and `hr-profile.ts` use the same shape. A
discriminator beats a boolean for the reason that file demonstrates — it records *where the number
came from* rather than *whether to trust it*, so a third source can be added later without
rewriting every reader. Written into `RV-166` as an instruction, because the obvious
implementation is an `isEstimated` flag and that would be a second way of saying something the
codebase already says.

**`RV-166` is now fully specified.** All three approved changes are released to Lane B with their
acceptance criteria; nothing on this batch is waiting on the owner.

## The PR sat conflicted overnight, and the decisions were nearly lost

**#1794 did not merge.** Auto-merge was enabled and the branch went `dirty` — auto-merge waits for
checks, it does not resolve conflicts — so it sat from 11:33 on 09-27 until 09-28 while `main` moved
on by dozens of commits. **The owner's four answers existed only on that branch.**

Worse than the delay: another session, reading `main`, re-applied `Gate: owner` to all four with
fresh wording (*"the mockup has been shown; the code waits on his yes"*). That is correct behaviour
against what `main` said, and it meant the queue showed four entries waiting on an owner who had
already answered all four.

**Resolved by keeping this branch's newer text** — the conflict was `RV-166` only, where `main` held
the earlier *"owes a mockup first"* framing and this branch holds the approval, the walk flow and
the estimated-source decision. One line of history records the supersession. The gates the other
session added are cleared and the stale `Ask:` fields dropped, taking queue-wide `Ask: owner`
21 → 18.

**The lesson is about the mechanism, not the session.** Enabling auto-merge is not the same as the
PR merging, and nothing notifies you when it goes conflicted. A decision-carrying PR needs its merge
confirmed, not assumed — the same class as the standing rule that a check being green is not a check
having run.
