# 2026-09-23 — RV-110 / RV-112: tab navigation and the shared scroll slot (`fix/rv110-rv112-tab-nav-shell`)

Batch `tab-nav-shell`, both from Review sweep 53.

## RV-110 — 15 sites, not 37, and that distinction is the work

The entry counts **37** `router.push('/health'|'/nutrition'|'/more'|'/workout')` sites and reads
them as cross-tab navigations that tear the shell down. The grep is exact; the implication is not.
Classified against `tabKeyForHref` (`components/shell/tabs.ts`), which matches an **exact** path and
explicitly excludes `/workout?session=`:

- **15 are genuine tab destinations** — converted to `navigateToTab`.
- **22 are not tabs at all**: sub-routes (`/health/day`, `/health/sleep`, `/health/week`,
  `/more/details`, `/more/settings/…`) and the full-screen `/workout?session=…`. `tabKeyForHref`
  returns null for every one, so `navigateToTab` would only forward them to `router.push` while
  *reading* as a tab flip. Converting them would be misleading, not safer. They stay.

`scripts/check-tab-navigation.js` holds the 15 at zero and encodes that boundary, so a later sweep
cannot "finish the job" by converting the other 22. It runs in the Custom Rules job —
**`Ran 76 of 76`**, up from 75. The check was verified to fail: a reintroduced `router.push('/health')`
in `walk-summary.tsx` was caught by name and line, then passed again once reverted.

## RV-112 — Home and More shared one scroll slot

The key is `keySuffix ? ${pathname}#${suffix} : pathname`. Health passed three suffixes; Home and
More passed none, and both stay mounted, so both wrote and restored one slot with no owner check on
the restore. Fixed with `scrollKey="home"` and `scrollKey="more"`.

**The suffix is what separates them, not the path** — `usePathname()` reads the route tree, which a
tab flip leaves stale (LA-109), so the pathname half of that key cannot be relied on to differ
between two mounted tabs. That reasoning lives in `more-content.tsx`; Home carries a one-line
pointer, because `session-select-content.tsx` is a size-ratcheted hotspot and the full comment put
it over. `e2e/scroll-restoration.spec.ts` — which RV-112 notes was never run — passes, 5 of 5.

## The premise I could not verify, stated plainly

RV-110's mechanism is that a push to a tab href unmounts `TabShell`. That is consistent with the
code (each tab's `page.tsx` renders its own `TabPage` → `TabShell`), but **this PR ships no e2e
proving it.** A first attempt marked a DOM node and asserted it survived a flip; the marker then
also survived what was supposed to be a teardown, so the spec was not discriminating and was
deleted rather than shipped. The reason was my own error — the "teardown" control dispatched
`ta:tab-navigate` with a non-tab href, which `onNav` ignores *without* `preventDefault`, so
`navigateToTab` (the thing that calls `router.push`) was never involved and nothing navigated at
all. A valid control has to drive a real push through the UI.

## A wrong turn worth recording, because it nearly cost 37 files

Reading the source, I concluded `useSearchParams` cannot see a tab flip — `show()` ends in raw
`window.history.replaceState`, and the shell's own LA-109 comment says Next re-injects its stale
tree. Plausible, and **false**. Measured under the harness: `/health?tab=body` from Home lands on
`Body=true` at first mount, and `/health?tab=training` into an already-mounted Health lands on
`Training=true`. Next's patched `replaceState` does update search params; LA-109's stale-tree
problem is real and does not extend to them. Had I not probed, the next step would have been a
shell-carrier mechanism plus a 37-file sweep on a false premise.

A separate probe found `/nutrition?review=day` not opening the review sheet on a first flip into an
unmounted Nutrition, reproduced twice — but instrumenting the reader showed `searchParams` arriving
**correct** (`review=day`) at both the initializer and the effect. So it is not a param-delivery
problem and not RV-110's subject. Filed as LB-129 rather than chased here.

## Not exercised

Native SQLite / Capacitor, safe-area, Samsung WebView, drifted production data. **No device
sitting** — recorded so `next-item.js --sittings` finds it. The shell-teardown premise itself is
untested end-to-end, as above.
