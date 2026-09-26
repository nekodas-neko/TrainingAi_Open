# The "Reorder sections" button can reorder sections

Implementation Lane B, 2026-09-26. `BF-205`.

## The defect

The owner: *"when I click the grid button on the home screen I cannot move widgets and re-arrange
them."*

It was not a broken drag — there was no drag. `HomeSortableSection` was named *Sortable*, took an
`id`, and held one hide button: no `useSortable`, no `DndContext`, no pointer handler, no handle.
Everything around the gesture was built, which is why it read as broken rather than absent — the
header button set `sectionEditMode` and said `aria-label="Reorder sections"` with `aria-pressed`,
the order was state with `loadSectionOrder`/`saveSectionOrder` behind it, and a `useLayoutEffect`
kept a ref fresh *"so drag/sync handlers can read it synchronously"*. Only the `/sync` half of that
comment had ever been written: `setSectionOrder` had four call sites and not one was a gesture.

## What shipped

- `components/home-sortable-section.tsx` is a `useSortable`, with a grip that appears in edit mode
  beside the existing eye-off, and `disabled` outside it.
- `lib/hooks/use-home-section-drag.ts` reorders on `dragover` and persists on `dragend`.
- `components/home/section-order.ts` is the move itself, by key.
- `e2e/bf205-home-section-drag.spec.ts` drags a section and reloads the page.

## The drag is on a handle, and that is the device fix

Home's sections scroll vertically. A whole-card drag would put the reorder and the scroll on the
same touch, which is the direction-lock class `docs/mobile-ui-and-performance.md` warns about and
exactly what this entry's own pass test says to check. A handle makes "a plain vertical scroll
does not pick anything up" true by construction rather than by tuning a threshold.

`touch-none` on the grip is the other half: without it the browser claims the gesture for the
scroll before `PointerSensor` ever sees it, and the drag silently never starts — on the device
only. A source guard holds both, because that class is what a later tidy-up removes.

## Two things the entry could not have known

**`savePreference` is not a `localStorage` write.** It also PATCHes the server, so persisting on
`dragover` would have put a request behind every position the thumb passed. It persists on
`dragend` instead, and the guard pins that the per-event handler does not save.

**The reorder has to address by key, not index.** Home renders
`sectionOrder.filter(k => !hiddenSections.has(k))` and then drops any section whose content comes
back `null`, so the list on screen is a subset with gaps: dropping onto the third visible card
must not move the third stored key. `moveSection` works in keys, and the unit tests pin the
hidden-section case along with the two races — an unknown key on either side is a no-op, because
the card-widget reconciliation rewrites this list when a widget is toggled in More.

## The size check earned its keep

The first version put both handlers inline and `check-component-size` failed:
`session-select-content.tsx` at 1,465 lines against its 1,448 baseline. That file is a known
hotspot and the rule says extract rather than append, so the handlers became a hook. The check
caught it before the diff was ever pushed.

## A harness lesson worth more than this entry

The spec was flaky at first and **the flake looked exactly like the defect**. Two fixes, in order:

`getByRole('button', { name: 'Drag to reorder section' })` matched **twelve** elements against six
handles — Home's cards are `role="button"` wrappers and the grip sits inside one, so the name
resolved onto both, and `.all()[0]` handed back a 412×266 box. The drag began on a card. An
attribute selector fixes it.

Then it still failed about one run in three. `@dnd-kit/dom`'s `PointerSensor` defaults say why: a
mouse press lands with **no activation constraint only when its target is the handle**; anything
else gets a 200 ms delay, a 5 px distance, and `preventActivation` for interactive elements — and
Home's sections are interactive, so a press that misses the grip by a pixel is blocked outright.
Cards resolve asynchronously here, so the layout shifts between measuring and pressing. The spec
now re-measures, confirms with `elementFromPoint` that the point is over the grip, retries, and
**throws a message that says the harness missed** rather than letting it read as the app not
reordering. Three clean runs, and the control (unwiring `onDragOver`) still fails with the other
message.

## Failure surfaces not exercised

The S25. A CDP pointer is not a thumb on a Samsung WebView, and the third clause of the pass test —
a plain vertical scroll in edit mode picking nothing up — is only answerable there.

## Verification run here

`pnpm lint` 0 errors / 827 warnings (828 on the base — one fewer here) · `pnpm check:rules` Ran 80
of 80 · `pnpm test` · `pnpm build` · `tsc --noEmit` · `check-test-typecheck` none above baseline ·
11 unit tests · `e2e/bf205-home-section-drag.spec.ts` 2 tests, three consecutive clean runs, with
a control run that fails on the unwired build.
