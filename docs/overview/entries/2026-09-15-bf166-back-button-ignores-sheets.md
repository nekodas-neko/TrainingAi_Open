# 2026-09-15 — BF-166: the back button cannot see an open sheet (BugFix intake)

Docs-only. Owner: *"If you have a nutrition meal creator menu open and you press the back button - it
makes the page behind it go back to main."*

## Three guards, none of them an overlay

The global Capacitor `backButton` listener checks an active workout, an active guided walk, and an
active activity — each a full-screen *mode* held in a Zustand store — then falls through to:

```ts
case "home": navigateToTab(routerRef.current, "/"); break
```

`/nutrition` is a tab, so `backActionForPath` returns `"home"` and the app goes to Home with the
builder still open on top. His sentence describes that line exactly.

## Why it never showed up in a browser

**Android's hardware back does not produce an Escape key.** Radix closes a `Sheet`/`Dialog` on Escape
and on an overlay tap, so the web build looks correct. The Capacitor `backButton` event is a separate
channel that the overlay primitives know nothing about — which is also why the three guards that do
exist are all store-backed modes: those were the only closable states anyone had a handle on.

## It is every overlay in the app

**52 files** render a `<Sheet>` or `<Dialog>`, and **no overlay registry exists** — `grep` for
`openOverlay|overlayStack|topOverlay` returns nothing. Over a tab route any of them sends the user
Home; over a sub-route it pops the page. The meal builder is just the one carrying enough typed-in
state for the loss to be obvious.

## The fix is central, not 52 changes

A module-level stack that `SheetContent` and `DialogContent` push to on mount and pop on unmount,
consulted by the listener before `backActionForPath`. Two primitives and one guard; every consumer is
untouched because they already route through those primitives.

**Order is the subtle part, and the entry pins it.** The overlay check goes **after** the three mode
guards, not before — a confirm dialog raised *by* one of those guards is itself an overlay, so
checking overlays first would make the second back press close the confirmation instead of answering
it. Mid-workout back must still reach its own prompt.

Out of scope: what back does with nothing open. `backActionForPath` returning `"home"` on a tab is
deliberate — tabs are peers reached by `replaceState`, so there is nothing to pop.

## Not exercised

Docs only. The listener, the three guards and the absence of a registry were read in the shipped
source; the 52 is a `grep` count.
