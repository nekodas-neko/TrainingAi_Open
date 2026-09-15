# 2026-09-15 — BF-165 narrowed: the tap fires, the navigation doesn't (BugFix intake)

Docs-only. BF-165 was filed with three ranked runtime candidates and one question for the owner:
does the sheet close? His answer settles it.

> *"When i tap any activity from other activity it just scrolls to the top of cardio hub."*

So the sheet **closes**, the screen **stays** on `/cardio`, and the hub **scrolls to the top**. A tap
that never fired would not move the scroll. A chunk-load failure would not either.

## The scroll reset is the evidence, not a side effect

`cardio-content.tsx:87` scrolls in a **nested `overflow-y-auto` div**, not the document scroller.
`use-scroll-restoration.ts` opens by saying it works on the *"window/document scroller, so it cannot
see, save or restore a nested element's `scrollTop`"* — and `/cardio` does not call it anyway; only
`pull-to-sync` and `nutrition-content` do.

A view transition snapshots and re-lays-out the page. The root scroller survives that; a nested one
is not covered. So `startViewTransition` **completing without a navigation** leaves exactly what he
described: same screen, scrolled to top. That is candidate 1 from the original entry, and it demotes
the other two.

**Recorded as the mechanism that fits, not as a measurement** — it is not verified on device, and the
entry says so. Proving it costs one console line: log `location.href` inside the commit poll and see
whether it ever changes.

## What it changes about the fix

The question is no longer "does the tap fire" but **why `router.push('/activity')` does not commit
inside the 300 ms cap**. The sheet's `onOpenChange(false)` runs in the same tick immediately before
the push, and Radix unmounts the portal on close — that ordering is the first thing to try moving.

The entry now warns against the obvious wrong fix: **raising `NAVIGATION_TIMEOUT_MS` turns a dead tap
into a slow dead tap.** The cap is a safety net for a navigation that never lands, not the reason
this one doesn't.

## Not exercised

A local `pnpm dev` was started to reproduce this and could not: `/cardio` and `/activity` both sit
behind `auth()`, and the sandbox has no session. That is why the mechanism above is reasoned from the
source rather than observed, and why the entry still asks for one device console line.
