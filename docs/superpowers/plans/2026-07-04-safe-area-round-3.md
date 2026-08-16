# Safe-area round 3 — buried FAB, unguarded drawer, doubled sheet insets

> Source: post-update review 2026-07-04 (safe-area pass). Follow-up to the safe-area
> system (#152) and round 2 (#189) — this is what those two passes still missed.
> Anchors verified against `main`; **re-grep before editing**. Ships as **one PR**
> (patch, merge-gate-exempt). Two mechanical facts underpin several tasks, both
> verified in-review: (a) `tailwind-merge` does **not** recognise the custom safe
> classes, so `p-0`/`pb-safe` never strip a baked `pb-safe-action`; (b) the custom
> utilities are defined *after* the Tailwind import in `globals.css`, so the
> later-defined class wins any tie. **All of this is device-only** — the web sandbox
> reports a 0 inset, so every fix here is verified by code + the S25 smoke
> checklist, not by Playwright.

## Task 1 — Lift the AI chat FAB above the bottom nav (HIGH)

**Root cause:** `components/ai-chat-overlay.tsx:166` renders the FAB
`fixed bottom-6 right-6 z-50` (spans 24–80px from the viewport bottom). It's mounted
uncontrolled on Home (`session-select-content.tsx:1273`), and `app/page.tsx` renders
`<BottomNav>` (`fixed bottom-0 z-50`, height `3.5rem + env(safe-area-inset-bottom)`
≈ 80–104px on the S25) *after* it in the DOM → same z-index, nav paints on top. On
device the FAB is entirely covered; even on web its bottom 32px are.

**Fix:** raise the FAB's bottom offset to clear the nav +
inset: `bottom: calc(3.5rem + 0.75rem + var(--safe-bottom))` (nav height + card
gutter + inset), applied whenever the FAB is rendered on a nav-bearing screen. Keep
it flush (`bottom-6 + var(--safe-bottom)`) on navless screens if it's reused there —
check the mount sites. Prefer a small shared class over an inline `calc`.

**Verify (device):** on Home, the FAB sits fully above the bottom nav and clears the
gesture bar; tapping it opens the overlay.

## Task 2 — Give the chat history drawer its own insets (HIGH)

**Root cause:** `components/chat.tsx:508` — `SheetContent side="left"`. Only
`side="bottom"` bakes `pb-safe-action` (`components/ui/sheet.tsx:71`); left/right
sheets are `inset-y-0 h-full` and bake **nothing**. The drawer's "Chat History"
header (`chat.tsx:509`, `px-6 py-4`) sits under the status bar and its `border-t p-4`
"New Chat" footer (`chat.tsx:541`) under the gesture bar.

**Fix:** add `pt-safe` to the drawer header and `pb-safe`/`pb-safe-action` to its
footer explicitly (side sheets bake nothing by design). Do not add insets to
`SheetContent` itself.

**Verify (device):** open the /chat history drawer — the title clears the status
bar, the New Chat button clears the gesture bar.

## Task 3 — Remove the doubled bottom insets inside bottom sheets

**Root cause:** `SheetContent side="bottom"` already carries `pb-safe-action`; these
add an inner `pb-safe` on a container inside it → ~2× inset on device. `p-0` on the
`SheetContent` does **not** remove the baked padding (tailwind-merge doesn't know
the custom class). Sites:
- `components/more/manage-friends-sheet.tsx:84`
- `components/more/title-picker-sheet.tsx:48`
- `components/admin/activity-icon-picker-sheet.tsx:38`
- `components/exercises/add-exercise-sheet.tsx:204`
- `app/nutrition/nutrition-content.tsx:454` (settings sheet; `SheetContent` at :450)
- `components/nutrition/food-logger-sheet.tsx:282,293,333` (`SheetContent` at :241
  uses `p-0` intending to strip padding — it doesn't; all three snap panels double)

**Fix:** drop the inner `pb-safe`/`pb-safe-action` from the container inside each
bottom sheet; rely on the baked padding. Where a sheet used `p-0` to zero the
padding and then re-added its own, remove both and let the bake stand. Also clean up
the redundant `pb-safe` **on the `SheetContent` itself** at
`deload-info-sheet.tsx:35`, `edit-profile-sheet.tsx:135`, `level-sheet.tsx:48`,
`goal-recommendation-sheet.tsx:190` (harmless today only because the bake is defined
later in `globals.css` and wins — but misleading and fragile).

**Verify (device):** each sheet's bottom content has a single gesture-bar gap, not
a doubled one.

## Task 4 — Fix `pt-safe` misused on a bottom sheet + the hardcoded overlay

- **`components/activity/activity-detail-sheet.tsx:57`** — `SheetContent side="bottom"
  … pt-safe`. A bottom sheet never reaches the status bar; `pt-safe` adds ~44–60px
  of dead top padding on device (looks fine on web at 1rem). Change to `pt-4`/`pt-5`.
- **`components/nutrition/barcode-scanner.tsx:152`** — full-screen portal
  `fixed inset-0 … pb-16 pt-12` hardcodes the edge paddings instead of composing
  `--safe-top`/`--safe-bottom`. On the S25 the "Point at a barcode" pill can touch
  the status bar. Replace with `pt-[calc(3rem+var(--safe-top))]` /
  `pb-[calc(4rem+var(--safe-bottom))]` (or the shared utilities). This evades the CI
  grep because it uses no literal `safe-area-inset` string.

**Verify (device):** the activity detail sheet has no dead top gap; the scanner pill
and Cancel button clear the status/gesture bars.

## Task 5 — Latent + CI-guard fixes (LOW, same PR)

- **`components/ui/bottom-action-bar.tsx:16`** — the `aboveNav` variant uses
  `bottom-14 pb-3`; `3.5rem` clears only the nav's content box, not its
  `env(safe-area-inset-bottom)` padding, so the first consumer's bottom inset-px is
  overlapped by the nav (nav z-50 > bar z-40). Change to
  `bottom: calc(3.5rem + var(--safe-bottom))`. (Zero consumers today — fix now so
  the primitive is correct when first used.)
- **Consolidate `pt-safe` and `pt-safe-or-4`** (`globals.css:317-326`) — byte-
  identical definitions; keep one, alias or delete the other.
- **CI regex upgrade** (`.github/workflows/ci.yml`): the stacking check only matches
  `pt-safe` *followed by* `pt-[0-9]`; extend it to (a) both orders, (b) `pb-safe*` /
  `pb-nav-safe` + `pb-*`/`py-*` combos, (c) `p-*` shorthands; and add a check for
  `fixed bottom-[0-9]` outside `bottom-nav.tsx`/`globals.css` (would have caught the
  FAB in Task 1). Verify each new rule fires on a hand-crafted violation, per the
  #154 discipline.

**Verify:** the new CI rules go red on a planted violation and green on `main`.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`.
- **Every task here is device-only** — the sandbox renders insets as 0. Verify on
  the S25 via `docs/device-smoke-checklist.md` (safe-area section) and declare in
  the PR that Playwright cannot exercise any of it.
- Patch bump + changelog; merge-gate-exempt. Remove this backlog entry in the same
  PR.
