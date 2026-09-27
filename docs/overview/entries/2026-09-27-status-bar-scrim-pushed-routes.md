# DV-22 — the scrim was one layer too low

**Branch:** `fix/status-bar-scrim-pushed-routes` · **Lane B** · `app/layout.tsx`,
`components/shell/**`, `lib/shell/**`.

`/health/sleep` scrolled under the status-bar clock with no backing. This is DV-6's defect on a
surface DV-6's fix never reached: the scrim was mounted in `tab-shell.tsx`, which was right for the
five tab panels and is exactly why the pushed routes had none. Nothing regressed — the fix was
scoped narrower than the defect.

## Three things were wrong, and each fails silently alone

The entry asked for two things to be established before building. Both were measured at 412 px
rather than read, and the second turned up a third fault.

**① Which layout every pushed route shares.** There is exactly **one** layout file in this app —
`app/layout.tsx`, whose `<main className="relative z-[1] h-full">` wraps every route. So the mount
hoists there, beside the other global singletons, and the shell's mount is removed. The stacking
order is unchanged: z-40 at the root still paints over the page (z-[1]) and under the warning
banners (z-[60]), the same order it had one level down.

**② Whether the controller still holds when the scroller is a pushed page.** It does not, for two
separate reasons. `/health/sleep` has **no inner scroller and no panel** — it scrolls the document,
and a document scroll's event target is the `Document`, not an Element, so `if (!(el instanceof
Element)) return` discarded it outright. And the panel scoping asked whether a scroller was inside
`[data-tab-active="true"]`, which a pushed route never is. The scoping is now stated as the
negative — a scroller drives the scrim **unless it sits in a panel that is off show** — so the
pushed route qualifies by the same rule rather than through a second branch, and
`document.scrollingElement` (never inside a panel) falls out of it for free.

**③ The re-evaluation trigger, which the hoist broke.** Two things change what is on screen without
firing a scroll event. A route change is `usePathname()`. A **tab** change is not: the shell swaps
panels with a raw `history.replaceState`, which the App Router does not observe — so the attribute
it flips is the signal, read by a `MutationObserver` with `attributeFilter: ['data-tab-active']`,
which fires only for that attribute rather than on every render in the subtree. Losing either is
silent: the scrim simply keeps whatever the last screen left it.

## Control-run both ways

- Reverted everything: the scrim is **not in the DOM** on `/health/sleep` — the reported defect.
- Hoisted the mount but kept the old controller: the scrim is there and **stays at opacity 0**.

So both halves are load-bearing, measured rather than asserted. The tab test passes in both control
runs, which is what says DV-6 has not been regressed into.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 827 warnings · **10,566** unit tests passed
· build clean · controller suite 15/15 (three new cases) · the render spec green with the fix and
red without it, twice over.

**Not exercised:** the S25. Chromium cannot say whether the gradient composites on Samsung's WebView
or how it reads against the real status bar, which are the two things the device check is for; a
Known-Issues row states the pass test. One smaller gap: `document.scrollingElement` is null under
jsdom and is stubbed in the unit test — the browser probe read the real one, so no fallback was
added for a case the canonical runtime cannot produce.
