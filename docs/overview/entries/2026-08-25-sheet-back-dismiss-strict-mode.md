# 2026-08-25 — the back-dismiss hook survives StrictMode's double invoke (LB-10)

**Branch:** `fix/sheet-back-dismiss-strict-mode` · **Lane B** · no schema, no route, no APK.
**No version bump:** nothing the owner can see changes. The defect lives only on `pnpm dev`.

## What was broken

`lib/hooks/use-sheet-back-dismiss.ts` pushes a history entry when a sheet opens so the Android back
gesture closes the sheet rather than navigating the page, and calls `history.back()` in its cleanup
to take that entry away again. React StrictMode runs the cleanup→effect pair once on mount, so the
sequence becomes push → `back()` → push.

`history.back()` resolves its delta when it is **called**, not when it runs. Measured in a bare
browser (no React involved): the traversal targets the entry that was current *before* the second
push, and its `popstate` fires *after* it — landing on the handler the second effect registered,
with `e.state` **and** `window.history.state` both reading `null`. Neither can be told from a real
back gesture, so the handler fired `onClose()` on the frame the sheet opened, and the pushed entry
went with it (`history.length` grew by one and pointed at an entry that closed nothing).

## What the entry got wrong

**LB-10 said five sheets were unopenable. One was.** The five call sites are all the hook has, but
four of them (`food-logger-sheet`, `food-library-sheet`, `morning-checkin-sheet`,
`end-of-day-review`) are mounted permanently with `open` **false** — so the double-invoked run bails
at `if (!open) return` before pushing anything, and the later flip to `true` runs once. Only
`QuickEditLogSheet` is reachable, because `nutrition-content.tsx` gives it `key={editingLog?.id}`,
which **remounts it with `open` already true**. Verified both ways in a browser against the running
dev server: the food-logger sheet opens identically with and without the fix; the quick-edit sheet
reports `dialogs: 0` before and `dialogs: 1` after.

The condition is *mounting already-open*, not *being a sheet*, and that is what the fix and the
guard are written against — a future call site with the quick-edit shape would have hit it too.

## The fix

A `selfPop` flag set by the cleanup that calls `back()`. When the handler sees it, the pop is its
own: it swallows it and re-pushes the entry that pop removed, instead of reading it as a dismissal.
The re-mounting effect skips its own push while the flag is set, so exactly one entry is ever owned.

The flag needs a way to expire, and that is the second half of the change. On an ordinary close
nothing re-runs to consume it, so it would still be set at the next open — which would skip the
push and leave the sheet with no history entry at all, turning a real back press into a navigation
off the screen. A one-shot `absorb` listener registered alongside the `back()` clears it, and the
re-mounting effect removes that listener before it can fire. Production reaches none of this: the
effect runs once, the flag is never set.

## Verified

- **`e2e/sheet-back-dismiss.spec.ts`** — new. Seeds a food log, opens the quick-edit sheet from the
  diary row, and asserts the dialog is still there a second later, that `history.length` grew by
  exactly one, and that one back press closes it and lands on `/nutrition` rather than off it.
  **Fails on the unfixed hook** (checked by stashing: `1 failed`), passes with it.
  The harness runs `pnpm dev`, which is the only surface StrictMode is on for — so this guard is
  meaningful in CI and would be vacuous against a production build.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 56 of 56** · unit suite green.

## Not exercised

Not run on the S25 APK. The change is dev-only in effect, but the hook is what the **real** back
gesture goes through on the device, so the entry keeps `Gate: device` for a back-press check on the
quick-edit sheet.
