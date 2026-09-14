# 2026-09-14 — LB-107: back on a tab lands on Home, because it was landing nowhere

**Lane B.** Branch `fix/lb107-back-on-tab-goes-home`. v1.456.6.

## What the owner asked for

*"Just need to make sure when you press back on a tab and there is no where to go it should go to
the home screen."* — 2026-09-13 app-shell pass. It had no entry of its own; it was recorded inside
**RV-36's body**, an entry that had already shipped, and would have been deleted with it. Clearing
RV-36 from the queue is what surfaced it.

## The entry's guess was wrong, and the measurement is the finding

LB-107 said *"exiting the app is the Android default when there is nothing to pop, so this is
likely absent handling rather than wrong handling."* Both halves are wrong.

The handling is **present**: `components/mobile-auth-handler.tsx` registers a Capacitor
`backButton` listener. Registering one **suppresses the Android default** — so the app was never
going to exit. The listener then called `window.history.back()` for every path except `/`.

`components/shell/tab-shell.tsx` flips tabs with `history.replaceState`, deliberately — its own
comment says *"tab flips are peers, not a history trail."* So a tab route has **nothing to pop**,
and `history.back()` there is a **silent no-op**. Back was not exiting the app on a tab. It was
doing nothing at all, on **all four** non-home tabs — not an edge case reached by a deep link.

The same comment claimed the design made *"Android back exit the app like a native tab app."* It
did not, because the listener intercepts first. That comment is corrected in this PR; a false
comment about the interaction under test is how this survived.

## The fix

`backActionForPath(pathname)` in `components/shell/tabs.ts` — `minimize` on `/`, `home` on a tab
route, `pop` otherwise — and the listener switches on it. Two things worth keeping:

- **Home is reached through `navigateToTab`, not `window.location.href = "/"`.** The shell is
  persistent and holds every mounted tab; a location assignment reloads the WebView and throws all
  of that away, turning an instant flip into a cold start.
- **Sub-routes are untouched.** `tabKeyForHref` matches the path **exactly**, so `/nutrition/meal/123`
  and `/workout?session=…` still `pop`. Only the five tab roots change behaviour.

## What was verified, and what was not

- `pnpm lint` 0 errors · `tsc --noEmit` clean · `pnpm check:rules` **Ran 74 of 74**, all passed.
- `components/shell/__tests__/back-action-on-tab.test.ts` — 7 tests. Includes a guard that fails on
  the old `pathname === "/" → minimizeApp … else history.back()` shape, checked against the real
  pre-fix text rather than assumed.
- `e2e/tab-flip-leaves-nothing-to-pop.spec.ts` — run locally, 4 passed. This is the part that is a
  claim about the app rather than about a function: it measures `history.length` across a tab flip
  (**unchanged**) against a sub-route push (**grows**). If a tab flip ever becomes a push, routing a
  tab back to Home would start skipping a real history entry, and this fails.
- **NOT exercised: the gesture itself.** The Capacitor `backButton` listener is native and the whole
  branch sits behind `Capacitor.isNativePlatform()`, so nothing in the sandbox reaches it —
  `pnpm dev` cannot, and `page.goBack()` is a different code path. **The S25 is the only real
  verification**, and it is recorded as owed in `projectOverview.md` and as LB-107's `Keep:`.

## Queue

LB-107 stays queued as a **KEEP** entry — shipped, device check owed. READY for Lane B went 8 → 7.
