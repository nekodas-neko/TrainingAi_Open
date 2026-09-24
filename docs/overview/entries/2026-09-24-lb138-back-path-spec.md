# LB-138 — the entry I filed reached the wrong conclusion, and the app's own comment says so

**Branch:** `fix/lb138-back-path-spec` · **Entry:** LB-138 (resolved, removed from the queue) · **Version:** unchanged

## What LB-138 claimed

I filed this after bisecting `e2e/la109-back-from-subroute.spec.ts`'s second test to `ef95595c11d`
(#1431). The failing assertion received **`"blank"`** — `about:blank` — and I wrote that *"in the
WebView that is the back gesture leaving the app or landing on nothing."*

The **mechanism** was right. `show()` flips tabs with `history.replaceState` on purpose — *"tab flips
are peers, not a history trail"* — so after `/health` → flip to Home → push to `/health?tab=training`
there is one entry, and #1431 converting the streak card to `navigateToTab` is what removed the push
that used to sit under it.

## Why the conclusion was wrong

On the APK the Capacitor `backButton` listener intercepts before the WebView's history is reached.
For a tab route `backActionForPath` answers `"home"`, so the listener calls
`navigateToTab(router, "/")`. `mobile-auth-handler.tsx` states the reason in place:

> The shell replaced rather than pushed to get here, so there is nothing to pop.

Chromium has no such listener. **That is the entire difference.** The `about:blank` result is a
web-harness outcome, and there is no defect on the runtime this app supports.

## So the fix was in the spec

The second test now dispatches the same tab navigation the listener does, instead of
`page.goBack()`, and proves exactly what its own docstring says it must: that **Home's tree renders**
rather than the tab whose tree is stale.

Scoped to that test alone, which is the part that needed checking rather than assuming.
`tabKeyForHref` is an **exact** path match, so `/more/details` resolves to no tab and
`backActionForPath` answers `"pop"` — a real `history.back()`. The first test's `page.goBack()` is
therefore the correct simulation and is untouched.

**Nothing new was added to pin the decision.** `components/shell/__tests__/back-action-on-tab.test.ts`
already covers all four cases — every tab → `home`, `/` → `minimize`, sub-routes → `pop`, and the
full-screen workout route → `pop`. A second copy would be noise.

## Verification

- `e2e/la109-back-from-subroute.spec.ts`: **4 passed**, both tests.
- The changed test cannot pass vacuously: the URL is `/health?tab=training` when the dispatch fires,
  and the `waitForFunction(pathname === '/')` immediately after it would time out if the event name
  were wrong or the shell did not handle it. The navigation is proven to have happened before the
  tree assertion runs.
- `pnpm check:rules` **Ran 77 of 77** · `tsc --noEmit` clean.

**What I did not do, and it matters:** I did not re-run this test against a deliberately broken
`tab-shell.tsx` to show the tree assertion still catches a regression. The docstring's original
"goes red unfixed" claim was about the **first** test; it records that this second one *passed
unfixed*, so it has always been a pin on already-correct behaviour rather than a repro. That is
unchanged by this edit.

**BF-49 stays open and is not addressed here.** Device sweep 3 reports *"back from a timeline row
lands on Health, not where you started"* — a real device symptom, and this spec's docstring already
recorded a measured negative result against linking the two.
