# 2026-09-13 — the vial sheet says which vial, and which numbers it keeps (BF-153)

**Branch:** `fix/vial-sheet-says-what-it-saves` · **Agent:** Implementation Lane B

The owner, with the sheet open and the right figures on it: *"Can you explain how this works? Where
am I meant to update the dose?"*

## Why that was a reasonable question

Two things, both verified against the file before any change — the entry's account was accurate in
every particular:

- **`Dose` was a calculator input that `save()` never posts.** The body is `{ ...draft, openedOn }`
  and `draft` is `strengthMg` / `waterMl` / `syringeUnitsPerMl`; `doseMg` is not in it. It is seeded
  from the definition's `defaultAmount`, drives the mg → units arithmetic, and is discarded on
  close. The real dose lives on the definition and is edited in `manage-supplements-sheet.tsx` under
  **Amount** — another sheet, another word for the same quantity.
- **Two dates, five lines apart, both correct, nothing saying they belong to different objects.**
  The `Opened on` input defaults to **today** because the form creates a NEW vial — BF-136 made that
  deliberate and it must stay — while `VialOpenedNote` below it read `current.openedOn`, the vial he
  already had. On his screen: 13/09/2026 and 10 Sept, simultaneously.

The cost is not cosmetic. The footer said *Save as a new vial*, and a stray press restarts the
weight-response window — which BF-136 established can only be corrected **in place**, because
`listSupplementVials` orders by `openedOn DESC` and the sheet reads `vials[0]`, so a corrective vial
dated earlier sorts below the wrong one.

## What changed — presentational throughout

| before | after |
|---|---|
| `VialOpenedNote` below the form, unheaded | first on the screen, under **The vial you're using** |
| form headed `This vial` | **Open a new vial** (`Your vial` when there is none) |
| section headed `Dose`, field `Dose (mg)` | **Work out the units**, field **Try a dose (mg)** |
| nothing said the dose was unsaved | *"Not saved — this only works out what to draw. Your saved dose is 0.5 mg, changed in Manage supplements, under Amount."* |
| footer button, no warning | a line above it: opening a second vial restarts the window, and Change fixes the current one |

**The Dose field deliberately does NOT write the definition.** That would reverse BF-112's
separation of the definition from the day's log, and let a units calculation silently re-set every
future prompt. The pointer is words rather than a link: both sheets are siblings in
`supplements-section.tsx`, so a link means threading a callback and cross-sheet navigation, which is
past what this entry is.

## Verification

- `e2e/vial-dose-calculator.spec.ts` gains a second test that **seeds a vial dated nine days back**
  — equal to today the defect would be invisible — then asserts both headings, that the note's date
  and the form's input hold different values, the not-saved sentence, and the footer warning.
  Mutation-proven: restoring the old `Dose` heading and label fails it.
- The existing calculator test was updated for the new label (sibling sweep) and still passes.
- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean, `pnpm build` clean.

## Not verified

- **Not on the device.** BF-153's own check is owed on the S25: open the sheet with a saved vial and
  confirm the two dates can be told apart without reading code, and that pressing the footer button
  reads unmistakably as opening a second vial. Recorded as a Known Issue.
- The screen was measured at 412 dp in the harness, not on Samsung's WebView.
