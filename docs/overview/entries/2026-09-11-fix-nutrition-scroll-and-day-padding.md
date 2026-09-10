# 2026-09-11 — Nutrition keeps its scroll position, and `/health/day` clears the gesture bar (RV-36, RV-37)

**PR:** `fix/rv-36-nutrition-scroll-restoration` · **Lane B** · `app/nutrition/nutrition-content.tsx`,
`app/health/day/day-detail-content.tsx`, `components/pull-to-sync.tsx`, `e2e/scroll-restoration.spec.ts`.

Two `[app-shell]` items shipped together because **one device pass covers both** — CI is free, the
device is not.

## RV-36 — the tab that inherited nothing

BF-100 put `useScrollRestoration` in `pull-to-sync.tsx` and both its entry and the call-site comment
said that meant *"every screen using the shell inherits it"*. It means every screen using
**`PullToSync`**, and three do: `health-content`, `more-content`, `session-select-content`. The
Nutrition tab owns its own scroller and inherited nothing.

Measured with BF-100's own recipe (wheel scroll → in-app `router.push` → `goBack`): `/more` →
*Profile details* → back restores **840**; `/nutrition` → `/coach` → back saved **no** `ta_scroll:`
key and returned **0**.

The fix is one hook call on the tab's existing scroller — not a `PullToSync` wrap, which would also
hand Nutrition a pull-to-refresh gesture nobody asked for.

**The wrong phrasing is now gone from the call site**, not only from the backlog. Review corrected the
entry on 2026-09-03; `pull-to-sync.tsx:46` still carried it, and that comment is what a reader hits
first. It now says the thing worth knowing: *a screen that scrolls its own container gets no
restoration from being inside the shell — check the call, not the layout.*

**The gap really is one path.** Every other routable screen that scrolls at this viewport
(`/health/sleep`, `/health/heart-rate`, `/cardio`, `/config`, `/program`) contains no `router.push`
or `<Link>` to a deeper route — they are leaves, and re-entering one is a fresh arrival that correctly
starts at the top. That was counted by RV-36, and re-reading it held.

## RV-37 — a scroller with no bottom padding at all

`day-detail-content.tsx`'s container was `flex-1 space-y-4 overflow-y-auto scrollbar-hide px-4 pt-4`
— no `pb-*` of any kind. It is a sub-route, so nothing is anchored below it and the last card ends
flush with the viewport, which on the S25's gesture navigation is the gesture bar. It now carries
`pb-nav-safe`, matching the 68 px `/more` measures.

**This was never observed and still has not been.** The seeded fixture renders *"Nothing logged on
this day"*, so the container never becomes scrollable in the harness. The absence of padding is read
from source, and CLAUDE.md treats even a bare `pb-safe` as too little clearance here — but whether
the symptom is visible needs a real day with enough logged.

The **fifth-CI-rule question stays open** and is kept on the entry: all four safe-area rules fire on a
*wrong* utility, none on an *absent* one. A "full-height scroller with no bottom pad" check would need
an allow-list for the sheets and navless full-screens that legitimately have none, and that list is
worth drawing only once the device says the class is worth a rule.

## Verification

`e2e/scroll-restoration.spec.ts` gains the `/nutrition` → `/coach` → back case. All three cases pass
— and the new one was **confirmed red with the fix stashed**, failing on its precondition with
`Received string: "{}"` (nothing saved at all) rather than the ambiguous `expected 840, received 0`
that file's header records three earlier versions dying on. Naming which precondition broke is the
difference between a guard and a coin flip.

**Not exercised:** the S25. RV-36's check is the **system back gesture**, which is the one gesture the
harness cannot send — `page.goBack()` is not it. RV-37's is a day with enough logged to scroll. Both
are `Verify: device` on their entries and in one row on `projectOverview.md`.
