# 2026-08-25 — the back gesture stops navigating the page away (BF-27)

**Branch:** `fix/sheet-back-dismiss-sweep` · **Lane B** · **v1.372.0.** JS-only — no APK needed.

## What was wrong

`lib/hooks/use-sheet-back-dismiss.ts` was imported by **5 of 45** files rendering a `<SheetContent>`
and **0 of 6** rendering a `<DialogContent>`. Everywhere else the Android back gesture reached the
WebView, which navigated the page underneath the sheet away. The owner found it on a device smoke
run and asked for the review: *"there are many pages that dont do this well; so we should do a
review on these pages to make it all like this."*

## Shipped as one component, not a 40-site sweep

BF-27 scoped this as `useSheetBackDismiss(open, onClose)` at each site. It ships instead as
`components/ui/back-dismiss.tsx`, rendered by `SheetContent` and `DialogContent`. Three reasons, in
the order they decided it:

- **It is where this repo puts UI defaults.** A tap-target floor belongs in `button.tsx`, not in
  every caller — the repo's own rule. A per-site wiring is also a rule every future sheet has to
  remember, and the 40 that lacked it are what forgetting looks like.
- **Closing goes through Radix's own `onOpenChange`**, by clicking a hidden `Close`, rather than
  through a callback threaded in per site. So back takes the same path as the X button and every
  guard already on that path still runs — `config-screen`'s unsaved-work check, the feedback
  sheet's reset, each dialog's cancel arm. A hand-wired `onClose` could bypass any of them.
- **It reaches what a sweep could not.** `profile/level-sheet.tsx` is uncontrolled — a
  `SheetTrigger` with no `open` prop — so there was no `open` expression to hand the hook.

**The hook has to be a child of `Content`, not a call inside `SheetContent`.** `SheetContent`'s body
runs whenever its caller renders it, and every tab screen renders its sheets unconditionally with a
null prop; it is `Portal` that gates the inner tree on `open`. A hook one level up would push a
history entry for every *closed* sheet on the page. This cost a wrong first draft.

The five call sites that had the hook lost it — otherwise each would push twice and need two
presses. `food-logger-sheet`'s `handleClose()` is exactly the `reset(); onClose()` its hook call
passed, so routing through `onOpenChange` is behaviour-identical there; the other four passed a bare
`onClose`.

## The dialogs got it too, and that was a decision

BF-27 says the six `<DialogContent>` files need a decision rather than the same treatment, because
*"a confirm dialog dismissed by the back gesture may be the right behaviour or may be a lost
confirmation"*. They get it. All six were read: five delete/move confirmations, an edit form, a
weight picker and a 1RM calculator. Back reaches every one through `onOpenChange(false)`, which is
each dialog's **cancel** arm — the same thing Cancel and the X do. It cannot take a confirm arm,
because no dialog wires one to `onOpenChange`. That is also the Android convention: back cancels a
dialog, and `AlertDialog` is back-cancelable by default.

The spec asserts this on the **database**, not the screen — a dialog that closed and a dialog that
deleted look identical once it is gone.

## Verified

- **`e2e/back-dismiss-sweep.spec.ts`, three cases, all mutation-checked** — with the two
  primitive edits reverted, each goes red, and the failure is the real defect: `page.url()` is no
  longer `/health/day`, i.e. back navigated the page away.
  1. A sheet that was never wired (`ExerciseHistorySheet` on `/health/day`) closes on one press, and
     the pushed entry count is **one**, which is what a leftover per-site call would break.
  2. A confirm dialog closes and **the row is still in the database**.
  3. **The nest** BF-27 names as the real risk: Log Food → History pushes a second entry, one press
     closes the inner sheet and leaves Log Food open, a second closes Log Food, and the page never
     moves. Before this, most nests pushed no entry at all, so the per-instance `sheetId` that keeps
     them apart had never been exercised in the product.
- **The three `hideCloseButton` sheets were checked individually**, because they are the ones with no
  X at all — back is their only dismissal besides Save, so they depend entirely on this hidden
  `Close` being its own element rather than the visible one. `food-logger-sheet` is covered by the
  nest case above; `morning-checkin-sheet` and `end-of-day-review` were driven in a browser: each
  pushes an entry on open, one back press closes it, and the page stays put. That the three sheets
  that most need this are exactly the three that already had the hook is not a coincidence.
- `sheet-back-dismiss.spec.ts` still passes — the StrictMode mount-already-open case (LB-10) and its
  one-entry-per-open invariant survive the move into the primitive.
- `tsc --noEmit` clean · `next lint` clean on the new file · `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

**The Android gesture itself.** The harness drives `history.back()`, which is close to the gesture
and is not the same input — BF-27 says so and it is still true. The device check is what the entry
keeps, and it names the three presses worth making.

**No `forceMount` exists anywhere in the app**, checked, so there is no sheet whose content stays
mounted while closed — which is the one shape that would make this push entries forever.

## A local full-suite red I could not attribute, and did not merge on

Recorded in full because "flake" is not a root cause and this change touches every sheet in the app.

| Full run | Primitives | Result |
|---|---|---|
| A | with | `meal-label` failed · 66 passed |
| B | with | `meal-label`, `food-logging-complete`, `tabs-instant-paint (More)` failed · 64 passed |
| C | reverted | only the two back-dismiss specs failed, correctly · **all three of the above passed** · 63 passed |

Run C is **not a clean control** — the stash reverted `sheet.tsx`/`dialog.tsx` but left the five
call-site removals in place, which is why both back-dismiss specs failed there and is the expected
result of having no back-dismiss at all. What it does establish is that the same ten-minute load
produced none of the three failures.

**Against that: none of the three reproduces.** All fifteen tests of those files pass alone and as a
subset, with the change. And the failing set differs between A and B on identical code, which no
deterministic regression does.

**The `meal-label` one has an identified mechanism, and it is the spec's.** It fails on `decodeQr`
returning null for the **first** style of its decode loop. That loop gates on
`inkFraction > 0.01` — *any* ink on the canvas — and then reads pixels, so a canvas caught mid-draw
decodes to nothing. Nothing about that needs this change to be true; it needs the machine to be
slow, and `meal-label` alone is 2 of the run's 10 minutes.

**So the merge gate was CI, not this sandbox** — a fresh database, a fresh server, and nothing else
competing. It is also, per the repo's own note, the better signal. If E2E goes red there on any of
these three, it is real and this entry is wrong.
