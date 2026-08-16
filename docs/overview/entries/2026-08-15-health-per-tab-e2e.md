# 2026-08-15 — closing the E2E harness's largest blind spot, on the screen that had it

Q-297, first item. No version bump: test-only.

## The gap

Q-249's spec opens `/health` and asserts nothing in the viewport is a skeleton. Health mounts **all
three** of its tabs at once inside a `SwipeCarousel`, so only the default Training panel is ever in
view. `expectNoSkeleton` counts viewport-intersecting elements on purpose — an inactive panel is
mounted but unseen, and its data is fetched when you swipe to it, which is the whole point of
`health-content.tsx`'s per-tab fetch groups — but the consequence is that two thirds of Health was
being reported as covered while never being looked at.

That was not inferred. Q-249 measured it: forcing Health's Body-tile skeletons to never clear does
**not** fail `tabs-instant-paint.spec.ts`.

## The fix

`e2e/health-tabs-instant-paint.spec.ts` drives `?tab=training|body|progress`, which
`health-content.tsx` already reads on mount and in an effect, so the panel under test lands in the
viewport and the existing assertion means something for it.

The load-bearing line is the one before the assertion:

```ts
await expect(page.getByRole('tab', { name: tab.name, selected: true })).toBeVisible()
```

Without it the spec would happily re-assert the default tab three times and report full coverage —
the same false-confidence failure it exists to fix, one level up. `components/ui/segmented-tabs.tsx`
renders real `role="tab"` buttons with `aria-selected`, so this is a genuine check rather than a
text match.

## Verification

Four tests pass (setup + three panels). More usefully, the spec was checked against **the exact
mutation Q-249's spec could not catch** — `metaLoading` pinned true, so the Body tiles never leave
their skeleton. It fails, and it fails **only** the Body case: Training and Progress stay green. So
the new coverage is real and it is precisely scoped rather than broadly noisy.

Full E2E suite 10/10 (the parallel lane's `goal-round-trip.spec.ts` landed alongside).
`npx tsc --noEmit` clean · `pnpm check:rules` — **36 of 36**.

One thing worth recording about that tsc run: it first reported four `TS2307` errors for
`app/sheet/[id]/*` modules. Those routes were deleted by the parallel lane's Q-255 an hour earlier,
and the errors came from a **stale `.next/types`** in this working tree, not from the code. `rm -rf
.next` and it is clean. Worth knowing before diagnosing a phantom break after pulling a deletion.

## What is still open

The viewport rule is unchanged and correct, so **every other tabbed screen still has this gap** —
a single-URL spec covers one tab. Nutrition's date swipe is the obvious next one. Q-297 is updated
rather than removed: its remaining items are the write-path specs (log a set, a food entry, a water
entry) and promoting the `E2E` job to a required check once it has a track record.
