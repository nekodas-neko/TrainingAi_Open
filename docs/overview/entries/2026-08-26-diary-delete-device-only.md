# 2026-08-26 — the diary delete, and the regression it uncovered

**Branch:** `fix/diary-delete-intake` · docs-only · BugFix Intake

## What was reported

*"the delete feature doesnt work. so its not removing from my.UI"*, live on the APK, with the
quantity sheet open on a BARILLA Spaghetti row.

## First pass: drive it, don't read it

Playwright against `pnpm dev` — seeded row → tap row → tap the bin → confirm → row gone,
`SELECT count(*) … WHERE deleted_at IS NULL` = **0**. So the bug was device-only, and six layers fell
out: the local delete, the local read's `deleted_at` filter, `applyDelta`'s `sync_status='synced'`
gate, the outbox payload surviving into the push branch, and the absence of any flip back to
`synced`.

That left one question worth one tap: **does the confirm dialog appear on the device at all?**

## The answer root-caused it

*"it opens up the confirm dialog; but then instantly minimizes so we cant click it."*

Opens **and is then dismissed** — not the `pointer-events: none` variant, where it would sit there
ignoring taps. That distinction is what moved the search off Radix and onto
`useSheetBackDismiss`.

**The cause is BF-27, which shipped the day before (v1.372.0).** `BackDismiss` now renders inside
every `SheetContent` and `DialogContent`, so:

1. The trash tap closes the sheet **and** opens the confirm dialog.
2. The sheet's `BackDismiss` unmounts → its cleanup sets **its own** `selfPopRef = true` and calls
   `window.history.back()`, which is **asynchronous**.
3. The dialog's `BackDismiss` mounts — **a different hook instance**, `selfPopRef` clear — and
   pushes its own entry.
4. The pop lands on the **dialog's** handler. Its flag is clear and `e.state?.sheetId` is not its
   id, so it takes the genuine-back-gesture arm and closes itself on the frame it opened.

**The hook's guard cannot catch this, and its own comment explains why without realising it.** The
`sheetId` check exists to stop *"a nested sheet's `history.back()` cleanup from cascading into parent
sheet handlers"* — the parent/child case. This is the **sibling** case: one surface closing while
another opens. `selfPopRef` is per-instance, so the closing sheet's in-flight self-pop is invisible
to the surface that receives it.

**The blast radius is every close-one-open-another transition in the app.** The diary delete is
simply the first one that got pressed.

## Two things this changes

**The entry was retitled.** "Deleting a diary entry does nothing on the device" is a true symptom and
a misleading title once the cause is known — an implementer reading it would start in the nutrition
domain, which is the one place the bug is *not*.

**The obvious local fix is now the wrong one.** Moving the confirmation inline into the sheet — which
this entry recommended before the cause was known, and which fits artboard 6 — would make this
instance work and leave the cause running everywhere else. It is kept in the entry only so nobody
re-derives it.

## What BF-27's gate was for

BF-27 is `Gate: device`, unstruck, and its Keep line names this exact case: *"a confirm dialog (it
must cancel, not confirm)"*. It had not been pressed yet. The gate was right; the day between
shipping and pressing is where this lived.
