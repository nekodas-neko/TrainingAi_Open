## 2026-09-09 — A supplement stops offering two answers to one question (OR-104, surface half)

**Branch:** `fix/or-104-supplement-dose-surface` · **Lane B** · PR #1037

### What shipped

Three changes to `manage-supplements-sheet.tsx`, all of one idea: the structured amount is the dose,
and the free-text line is a note.

- **`Amount`/`Unit` come first.** Reading order was half the defect — a free-text field labelled
  `Dose` sitting above them reads as the answer, which is how a vial strength got typed into it.
- **The free-text field becomes `Note` once an amount exists**, with its placeholder changing to
  *"e.g. with food, morning only"* and a line beneath: *"The amount above is the dose. This line is
  just a note — it is not counted."*
- **The list row leads with the structured dose** and renders the free text as `Note: 10mg` beneath.
  That row was the only place the contradiction surfaced, and it showed the wrong side of it.

### The live case, and why it stayed invisible

`Retatrutide` carries `default_amount 0.5 · unit mg` **and** free-text `dose '10mg'` — the vial
strength, in the field labelled `Dose`. They disagree by **20×**. `supplementSubtitle()` falls back to
the free text *last*, so with a structured amount the nutrition list correctly read `0.5 mg today` and
the contradiction never appeared there. It showed only on the manage sheet's own row — where it
rendered `10mg`, the number the app does **not** use.

### Relabelled rather than hidden, and the reason is the live row

The entry offered both. Hiding the field once an amount is set would strand the text already in it,
and OR-104 says explicitly that existing rows are the owner's to correct by hand — a field you cannot
see is a field you cannot correct. Relabelling keeps `10mg` visible, editable, and clearly marked as
not the dose.

### Two things deliberately not done

**`definitionDose()` is not `supplementSubtitle()`**, though they look similar. The subtitle leads
with `loggedAmount` — "what did today record" — which on a definition-editing sheet would show a
number the form in front of you cannot change. Different question, so a second function rather than a
duplicated formula.

**No parser.** Comparing the free text against the amount to detect a real contradiction sounds
better and is worse: `10mg` beside `0.5 mg` is one, `with food` is not, and a guesser either misses
the real case or cries wolf on a note. *"This is a note, not the dose"* is true either way, so it says
that instead.

### Verification

8 unit tests on `definitionDose`/`hasFreeTextBesideAmount` — the live Retatrutide shape, zero as a
real amount rather than absent, an amount with no unit not rendering a dangling space, and free text
alone still being a valid dose (the pre-BF-112 shape).
`e2e/supplement-dose-note.spec.ts` drives the real sheet at 412 dp: the field is `Dose` with no
amount, becomes `Note` when one is entered, and the saved row shows `0.5 mg` with `Note: 10mg` under
it.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

`check-backlog-pointers.js` caught the first docs draft: it annotated OR-104's heading with what
shipped, and the check failed on *"these queue entries announce their own completion in the
heading"*. With both halves done, nothing was owed — the entry had to leave, not gain a note.

**Not exercised:** the S25 and Samsung WebView. And **the live `Retatrutide` row is untouched** —
this stops the contradiction being created and makes it visible; correcting that one row is still the
owner's, by design (BF-3's freeze is the point).

Patch bump — a labelling and ordering fix.
