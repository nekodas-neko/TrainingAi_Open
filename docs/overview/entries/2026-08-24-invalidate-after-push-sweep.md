# 2026-08-24 — sixteen writes revalidated around their push, not after it (LB-6)

**PR:** `fix/invalidate-after-push-sweep` · **Lane B**

## The bug, once

`pushMutations` is fire-and-forget. An invalidation written beside it fires while the server still
holds the pre-write state: every `useCachedValue` subscriber wakes on that signal, refetches the old
payload and **re-caches it**, and nothing invalidates again — so the stale value stands for the key's
full TTL. Home's Energy Balance card read 42 kcal high for exactly this reason (LB-4).

`pushThenRevalidate(userId, invalidator)` is the fix, and it already existed: the caller still
invalidates immediately — offline that is the only signal that will ever fire — and the helper runs
the same invalidator again once a push actually moved something.

## The entry said six. There were sixteen.

Its finder was *"a `pushMutations(` call with an `invalidate…(` within the six lines above it"*, and
**five sites write the invalidation below the push instead** — `water-log-sheet`,
`manage-supplements-sheet` ×3, `supplements-section`. The ordering of those two lines makes no
difference: neither is chained to the push's resolution.

Four more the entry never saw: `injury-sheet` ×3 and `done-screen`, where the invalidation sits after
an `if/else` that both branches fall through to.

And one I introduced myself in #333 the same week the helper shipped, copying the old shape from a
sibling: `packages/shared/src/nutrition/save-plan-meal.ts`.

**`app/nutrition/nutrition-content.tsx` had the mirror image** and was cited by the entry as the
shape to copy *toward*. It invalidates **only** after the push — which the helper's own docblock
says is worse: `pushMutations` never resolves usefully with no network, so an offline food-log
delete repaints nothing at all. It now does both halves.

## Why this became a check

`scripts/check-invalidate-after-push.js` fails Custom Rules on the class (55 steps now). Prose did
not hold it: LB-4 fixed three engine paths, LB-6's own finder missed five more, and a sixteenth was
written by hand days later. Two shapes are deliberately not hits — a bare `pushMutations` with no
invalidation near it (the Sync buttons and the provider's own passes own no cache key), and an
**awaited** push, where whatever follows already runs after the server has the write.

Mutation-checked: the check reports all sixteen against the pre-change tree and zero after.

## What is not claimed

**Which of the sixteen were load-bearing was not audited.** Per `CLAUDE.md`'s "what makes an
invalidation load-bearing", a stale entry only *settles* where a call site passes `freshWithinTtl` or
a read path is seed-only; elsewhere `cachedFetchCore` revalidates anyway and the cost is a briefly
stale paint. All sixteen are converted regardless — the cost is one line, and the condition changes
the moment someone adds `freshWithinTtl` — but no user-visible fix is claimed for any specific one.

**Not verified on device.** Every one of these paths writes to the local store and queues an outbox
mutation, and `getLocalStore` returns null in a browser, so the entire converted branch takes the web
fallback here. The ordering is verified by reading and by the helper's own unit tests.

Full local gate: 4,582 tests, 55 of 55 Custom Rules, lint clean.
