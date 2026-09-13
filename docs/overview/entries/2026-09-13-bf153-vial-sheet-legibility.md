# 2026-09-13 — BF-153: a screen with the right numbers that cannot be read (BugFix intake)

Docs-only. The owner had the Retatrutide vial sheet open, with correct values in every field, and
asked *"Can you explain how this works? Where am I meant to update the dose?"*

## The answer took reading the save path

There are three numbers on two screens and only two of them persist.

| what he sees | what it is |
|---|---|
| `Amount` in the manage sheet | **the dose.** `supplements.default_amount`, seeds every prompt |
| "How much did you take?" | a one-off override for that day only |
| `Dose (mg)` in the vial sheet | **a calculator input that is never saved** |

`save()` posts `{ ...draft, openedOn }` — `strengthMg`, `waterMl`, `syringeUnitsPerMl`. `doseMg` is
not in the body. It is seeded from the definition, converts mg to syringe units, and is discarded on
close. The field that says *Dose* is the one that cannot change the dose.

## Two dates, two objects, no label

`Opened on` defaults to **today** because the form creates a new vial — BF-136 made that deliberate
and its docstring explains why prefilling from the current vial would recreate the defect one vial
along. `VialOpenedNote` beneath it reads the vial he already has. On his screen: **13/09/2026** and
**10 Sept**, both correct, five lines apart, with the footer reading *Save as a new vial*.

That button is the reason this is not cosmetic. BF-136 established that a wrong opened-date can only
be fixed in place — `listSupplementVials` orders by `openedOn DESC` and the sheet reads `vials[0]`,
so a corrective vial dated earlier sorts below the wrong one. A screen that invites a press to "save
my dose" sits on top of that.

## The recommendation says what NOT to build

Making the Dose field write the definition would reverse BF-112's separation of the definition from
the day's log, and would let a units calculation silently re-set every future prompt. The fix is
presentational: name the create-form as one, put the vial in use above it, and label the Dose field
for the arithmetic it does.

## What needed no fix at all

Today's log already reads **1 mg** — he entered it at the prompt, which is exactly the surface for a
one-off change. The definition still says 0.5, so the *next* prompt starts there again. That is the
system working as designed and the owner not being able to tell, which is the entry.

## Not exercised

Docs only. The save path was read rather than run; the 1 mg log and the two dates were read from
production rows.
