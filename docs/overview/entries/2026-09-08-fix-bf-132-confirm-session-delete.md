## 2026-09-08 — Deleting a session asks first, and can be undone (BF-132)

**Branch:** `fix/bf-132-confirm-session-delete` · **Lane B** · PR #1001

### The report

The owner lost a session: *"it looked like you can delete the day in the builder with no confirmation
needed so if you accidently press the trash jts gone. I will need to remake with my lower session
details"*. `removeSession` was a one-line array filter fired straight from the trash button, and the
file held zero `confirm(` calls. The blast radius is the session and its whole exercise list, and on
Save both are hard-deleted from `program_sessions` and `session_exercises`.

### What shipped

**A confirmation that names the count** — *"Delete Lower and its 5 exercises?"*. The count is the
part that carries the warning; a generic "Are you sure?" trains the reflex to dismiss it, which on a
delete this expensive is worse than no dialog. `ConfirmDialog` already existed, so this is wiring,
not a new component. Singular/plural and the not-yet-named session are covered by unit tests.

**An in-sheet undo bar**, above Add Session, holding the last deleted session until it is restored,
another is deleted, or the sheet closes.

**Exercise delete is deliberately untouched.** Removing and re-adding an exercise is ordinary
editing, and a dialog on every one of those is the friction that gets a confirmation deleted a month
later. The session-level delete is the one that is rare and expensive.

### The undo was a toast, and a browser is the only reason it isn't

The first implementation raised a sonner toast with an Undo action. It typechecked, linted, passed
the unit guard, and **was dead to touch** — which nothing short of a real browser could have said.

Sonner's toaster sits at `z-index: 999999999` against the sheet's `z-50`, so the toast *paints* above
it. But `SheetContent` is a Radix modal: its subtree intercepts pointer events, and everything
portalled outside it stops receiving them. Playwright's log names it exactly — *"subtree intercepts
pointer events"* — after which the toast expired and detached. So the control was visible, correct in
source, and unusable.

Moving it inside the sheet also lands on the pattern this app already uses: `plan-meal-row.tsx` has
an inline undo, not a toast. The entry's claim that *"a toast with Undo is the established pattern
elsewhere in the app"* is not right, and is worth not repeating.

### And the undo button then failed BF-123's own guard

The inline Undo went out as `tap-dense text-sm font-semibold text-brand` — `tap-dense` opts a control
out of the global 48 px floor, and nothing replaced the touch area. `carousel-dot-hit-area.test.ts`
caught it in the full suite. The fix is not a hit-area trick: the button dropped `tap-dense` and took
the floor, which is what an isolated inline control in a row should do anyway. Worth recording
because this is the *third* distinct guard this one change tripped, and each one was a real defect
rather than a checker being fussy.

### Extraction, because the file is a hotspot

`program-editor-sheet.tsx` was 963 lines against an 800-line limit, grandfathered shrink-only, so
+33 lines failed the ratchet. The session header — drag handle, icon picker, name field, delete —
came out to `components/config/session-header-row.tsx`. That is the block this change touches, so
the extraction is the one the diff argues for rather than the one that saves the most lines. **947
lines**, below the 963 it inherited.

### Verification

The e2e (`e2e/session-delete-confirm.spec.ts`) drives the real screen at 412 dp: tap the trash, the
dialog names the session, **Keep** leaves the count unchanged, **Delete** drops it by one, **Undo**
puts it back with its name intact. It adds its own session and never presses Save, so the seeded
program is left as found.

Both source guards were mutation-checked — reverting the trash button to call `removeSession`
directly turns them red, in each of the two files the control now spans.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite **836
files passed, 0 failed** · the new e2e green, re-run after the touch-target fix changed the markup.

**Not exercised:** the S25 itself and Samsung WebView. Nothing here is native, offline-first or
safe-area, and the interaction is proven in a browser at the target viewport, so the residual risk is
rendering only.

### What is deliberately not done

BF-132's third fix — a `deleted_at` on `program_sessions` and `session_exercises` — is **LB-66**,
filed in this PR. It is a migration and therefore Lane A's. Until it lands, a *saved* delete is still
unrecoverable: this change makes the mis-tap unlikely and the wrong confirm recoverable, and stops
there.

Patch bump — user-visible.
