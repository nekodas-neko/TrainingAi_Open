# 2026-08-19 — freeze the fetch-once effects, and correct the count while doing it (Q-359)

Lane B. v1.325.4. One new Custom Rules step, one hook gained a callback, one site converted.

## What this is

Q-402 shipped the mechanism — `subscribeToInvalidation` + `useCachedValue` — after the owner
reported Home's energy bar needing an app restart. This freezes the sites that still have the old
shape, so the problem stops growing while the sweep happens at its own pace.

`scripts/check-fetch-once-effects.js` fails any **new** `useEffect(() => { … cachedFetch … }, [])`,
with a shrink-only per-file baseline: a file not listed must have zero, a listed file may only
shrink, and a file that reaches zero must have its row deleted so the inventory cannot rot into a
stale allowlist. Same shape as `check-hex-literals.js` and `check-memo-prop-stability.js`.

**The baseline is grouped by whether the site can actually bite**, which is the judgement the entry
asked for rather than a flat list:

- **Can bite — 19 sites.** Permanently mounted, so a write made without leaving the tab never
  reaches them. This is the group worth converting.
- **Deliberately fetch-once — 1 site.** `sync-provider` warms the cache on mount; it is not a
  reader, and converting it would add refetches nothing is waiting for.
- **Unmount on navigate or on a conditional render — 16 sites.** Their next mount refetches, so they
  are latent rather than broken, and some may never be worth converting.

### The grouping was wrong the first time, in a way worth carrying

The first draft put every sheet in the third group on the reasoning that sheets close. **They do not
unmount here.** `components/shell/tab-shell.tsx` keeps all five tab contents mounted once visited,
and the tab screens mount their sheets **unconditionally** — `<ActivityDetailSheet
log={selectedActivity} />` and `<ExerciseReviewSheet sessionId={reviewingSessionId} />` are rendered
with a null prop and self-hide, not rendered behind a boolean. So both are permanently mounted, and
so are the Health cards reached through `health-sections.tsx`.

Re-checked by tracing each file's renderer up to a tab screen rather than judging by where the file
sits, the first group went **from 14 to 19** — nearly a third more sites can actually go stale than
the first pass said. Judge these by mount site, never by filename.

## Two counting corrections, both found by mutation-checking the rule

**The scan behind the earlier "36 remaining" undercounted by one.** Its pattern required a newline
before the effect's closing brace, so it **missed single-line `useEffect(() => { … }, [])`
entirely**. Measured on `origin/main` with both patterns:

```
wide pattern (correct):  37 sites across 27 files
narrow pattern (old):    36
```

So the true remaining count was **37**, not 36, and `app/nutrition/nutrition-content.tsx` has **two**
fetch-once effects, not one. After the conversion below it is **36**, which is what the baseline
sums to.

This surfaced because the first mutation test of the new check **passed when it should have failed**:
a one-line effect inserted into a non-baselined file went undetected. That is the whole argument for
mutation-checking a guard rather than watching it go green — the rule looked correct, ran clean, and
could not see a shape that is perfectly ordinary. Both arms fire now: a new site fails, and a fixed
site left in the baseline fails too.

## One conversion, and what it needed

`ObservedHrCard` renders inside the Health tab, so it is squarely in the first group. Converting it
required `useCachedValue` to grow an **`onError`** callback: `cachedFetch` swallows `!res.ok`,
including this app's own rate limit, so a card without one cannot tell "no data" from "the request
failed" — and the standing rule is that it must show an error state rather than vanishing. The
callback is held in a ref, so a caller passing an inline arrow (which is every caller) does not
re-run the fetch effect on each render.

That is 37 → 36 by count. The file leaves the baseline entirely rather than being lowered, since it
reaches zero — which is what the shrink-only rule requires.

## What was NOT exercised

- **36 sites are untouched.** This entry stops the growth; it does not do the sweep.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- **The `onError` path was not triggered.** It is wired and type-checked, but nothing here made
  `/api/hr-profile` fail, so the error card was not rendered.
- **The check is regex-based, not AST-based.** It now catches both single-line and multi-line
  effects, but a `useEffect` whose callback is a named function defined elsewhere, or one built
  through a helper, is invisible to it. A clean run is not proof of full coverage.
