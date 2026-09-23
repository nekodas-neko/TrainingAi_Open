# 2026-09-23 — RV-115: More's sub-tab swap crossfades and starts at the top

**Branch:** `fix/rv115-more-subtab-crossfade` · **Lane B** · v1.465.21

## What shipped

Profile ↔ Friends on the More tab swapped via two `<div style={{display}}>` inside one shared
scroller: no motion, and the scroll offset carried across. Both views now swap through the existing
`<TabPanels value={tab}>` — the primitive Friends' own child views already use — and the scroller
returns to the top on each swap.

## The entry's fix was not implementable as written

It said "reset `scrollTop` in `onValueChange`". `PullToSync` owns `scrollRef` privately and exposed
no prop, so the call site cannot reach the element it needs to move.

Added `scrollResetKey` to `PullToSync` instead. **Structural call, Lane B's:** the reset belongs with
the component that owns the scroller rather than being threaded out to every caller, and Health's
three-tab scroller can use it next. Reversal is deleting one prop and one effect.

It deliberately skips its first run. `useScrollRestoration` re-asserts a saved offset across a whole
window after mount, so a mount-time reset would fight the restore — the same scroll-key machinery
RV-112 dealt with earlier today.

## The `mode="wait"` caveat resolves — checked, not assumed

`TabPanels` is `AnimatePresence mode="wait"`, so the outgoing panel unmounts. The entry flagged that
this could trade a hard cut for a skeleton. It does not: both panels re-seed synchronously from
cache — `profile-tab.tsx` in a `useLayoutEffect` with `readCacheSync`, `friends-tab.tsx` with
`readCacheSync('friends-list')`.

**But it costs UI state, which the entry did not name.** Unmounting discards Friends'
feed/leaderboard choice and Profile's expanded sections on every swap. Accepted: More's traffic is 7,
the data is untouched, and the alternative — keeping both mounted for a real crossfade — needs
absolute positioning inside `PullToSync`'s scroller and risks the layout bugs that machinery already
carries. It is written into the code comment so it is not later rediscovered as a bug.

## One limitation, deliberately not fixed

Switching sub-tabs *within* the restoration's re-assert window after entering More can still let the
restore win. That is the behaviour today, so it is an incomplete fix rather than a regression.

## Verification

- `components/__tests__/rv115-more-subtab-crossfade.test.ts` — 5 assertions. The load-bearing one is
  that **both panels still seed from cache**: delete that seeding and this swap silently becomes a
  skeleton flash on every switch, and nothing in More would fail.
- Control: removing `scrollResetKey` fails 1 of 5.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 77 of 77** · full suite green · build clean.

## Not exercised

Device. A 150 ms crossfade is a feel judgement and the sandbox can only prove the primitive is wired
in. Also not exercised: native SQLite, safe-area, Samsung WebView, drifted prod data.
