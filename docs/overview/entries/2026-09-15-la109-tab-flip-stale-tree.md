# 2026-09-15 — LA-109: the tab flip's stale route tree, and the BF-49 link it did not survive

**Branch:** `fix/la109-tab-flip-stale-tree` · **Lane B**

The owner: *"Going to more; then going to profile details and pressing back gets me to the home page
again."* Two lines of production code, and the session's actual output is a negative result about a
different entry.

## The fix

`show()` flips tabs with `window.history.replaceState(null, "", href)`. Next patches `replaceState`
and re-injects **its own current tree** — still the previous tab's, because no Next navigation
happened. So the `/more` entry carries the route tree for `/`. Back restores it, Next renders
`(home)/page`, and `TabShell` is handed `initialTab="home"` while the address bar says `/more`.

The entry's own suggested shape was to hand `replaceState` a state object carrying the destination
tab's tree, and it flagged that this reaches into `__PRIVATE_NEXTJS_INTERNALS_TREE` and should be
measured before adopting. It did not need adopting. **The address bar is already correct** — it is
the only half of that history entry the bug does not corrupt — so reading it at mount is sufficient
and touches no internals:

```ts
const [state, setState] = useState<ShellState>(() => {
  const fromUrl = typeof window === 'undefined' ? null : tabKeyForHref(window.location.pathname)
  const start = fromUrl ?? initialTab
  return { active: start, mounted: [start], epochs: { … } }
})
```

`usePathname()` would not work here and the reason is the whole bug: it reads from the very tree that
is wrong, so it would agree with `initialTab` and change nothing.

## The check that made it a fix rather than a green test

**The spec was run against `main`'s unfixed `tab-shell.tsx`, and the sub-route test goes red there.**
This is not ceremony. The first draft of that same spec used `page.goto('/more/details')` — a full
document load, which rebuilds history from scratch, so the stale entry never survived to be popped.
It passed while the bug was completely untouched, and the entry had *warned* about exactly this one
line above where the mistake went in. Tapping the real `router.push` affordance is the whole spec.

## The part worth keeping: BF-49 is not this

LA-109's entry said BF-49 — *"tapping a workout, then back, leads to health training not home"* — was
*"very likely the same defect"*, and instructed that neither be fixed until one had been tried
against the other's repro. The theory was clean and symmetric: a real load of `/health` leaves Next's
tree on Health; flipping to Home rewrites the URL to `/` and leaves that tree behind; a push off Home
and a back should render Health under a `/` URL, which is the report verbatim.

**The trial was run. It refutes the link.** The second test in
`e2e/la109-back-from-subroute.spec.ts` drives that sequence with the precondition supplied
deliberately — real `goto('/health')`, a **flip** to Home, `router.push('/health?tab=training')` off
the streak card, back — and it **passes against the unfixed file**, in the same run where LA-109's
own test fails. The sequence will not break even when handed the stale tree on purpose.

That is a stronger negative than BF-49's existing *"does not reproduce in the web harness"* note,
because that one had an available excuse — its repro began with a `goto`, so no entry ever carried a
stale tree. This one begins with the flip. The excuse is spent, and BF-49 goes back to needing the
device repro it has asked for since 2026-08-30.

The test stays in the file as a regression guard — the reverse direction is what a naive version of
this fix would break — with a docstring saying in as many words that it is **not** a BF-49
reproduction, so a future green run is not read as a confirmation. A vacuous test that nobody has
labelled is worse than no test, because it answers.

## Not exercised

**No device pass.** The Android system back gesture and the WebView's history handling are not
reachable from the sandbox; `page.goBack()` is the same history step, not the same gesture. Kept as
LA-109's `Keep:` and a `projectOverview.md` row.

**BF-100 is unblocked but untested.** It could not be read while this stood — if back renders Home
there is no `/more` scroll position to restore. Its own `touchstart` candidate cause is untouched and
still needs the device.
