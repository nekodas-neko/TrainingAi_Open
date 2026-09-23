# 2026-09-23 — DV-6: a gradient behind the status bar, once, in the shell

**Branch:** `fix/dv6-status-bar-scrim` · **Lane:** B · one component, one controller, one wire-up

On Home, scrolled, the energy bar's caption ran behind the status bar's clock with nothing between
them. The owner was offered a solid strip and chose the fade, so the app stays edge-to-edge and
nothing loses the ~28 px a flat backing costs. It fades in on scroll and is absent at rest.

## Why one listener in the shell, and why it has to be capture

The owner's constraint was "in the shell once, not per screen" — a per-screen scrim is a rule every
future screen can forget, which is how this defect reached a device sweep in the first place.

That is harder than it sounds here, because **this app has no document scroll**. Every tab scrolls
its own inner container: three through `PullToSync`, and Nutrition owns a separate one. `scroll`
does not bubble, so a listener on an ancestor sees nothing — unless it registers in the **capture**
phase, which does reach it. One `document.addEventListener('scroll', h, true)` in `TabShell` covers
all five panels with no screen opting in.

The shell marks the panel on show with `data-tab-active`, and the controller scopes each event with
`closest()`. Without that, a hidden panel or a sheet scrolling would paint over the screen you are
actually looking at.

## The open question the entry recorded, and its answer

A panel keeps its scroll offset while hidden, so flipping back to a tab left scrolled down fires no
scroll event and a naive implementation shows nothing until you touch it.

The controller keeps a `Set` of every element it has seen scroll — bounded by the number of
scrollers in the app, a handful — and on each activation re-reads the ones inside the newly active
panel. A tab never scrolled is absent from the set and correctly shows nothing. Detached nodes are
dropped on the way past, so a torn-down screen cannot pin the scrim on.

## The logic is not in the component, and that is not a style choice

**Every vitest project in this repo is `environment: 'node'` and cannot transform `.tsx` at all** —
measured: importing the component fails at parse, first with JSX in the test and then with JSX in
the component itself. That is why there are no component-rendering tests here, and it is a hard
constraint rather than a convention to argue with.

It matters because of how this fails on device: a dead scrim and a mis-scoped one look identical —
nothing there. So logic left inside the component is logic nothing can drive, and the device check
cannot isolate it either. The decision moved to `lib/shell/status-bar-scrim-controller.ts`, a plain
`.ts` module with **12 tests** (jsdom through a per-file `@vitest-environment` docblock, which needs
no config change). The component is the div.

Its four wiring constraints are pinned by reading its source, since the tests register the listener
themselves and so would otherwise prove the controller's logic while saying nothing about whether
the component asks for capture.

**Control runs, because a green test that cannot fail proves nothing:** with `reevaluate` neutered
the tab-flip test fails; with the component's `true` capture flag removed the wiring test fails.
Both restore green.

## Two things measured rather than assumed

**`var(--page-bg)` is the wrong colour to fade from.** `DynamicBackground` sets it to `transparent`
when active, so a gradient built from it is invisible in exactly the case the scrim exists for. It
fades from `var(--background)`, which holds the theme base either way.

**The height is the `pt-safe` utility, not a hand-written `--pt-safe-value`.** An empty `pt-safe`
div is exactly inset-height and the gradient paints over the padding box. Referencing the variable
directly **fails** the Custom Rules check that every safe-area utility be a defined class — the run
reported `pt-safe-value` as used-but-undefined, which is the check doing its job on a name that
merely looks like a utility. The utility floors at 1rem, which matters because three-button
navigation reports the inset as 0.

## Not done, and not claimed

**The device look is owed** (`Verify: device` + `Keep:`). The sandbox cannot judge the one thing
most likely to need tuning: how the gradient composes with `DynamicBackground`'s sky, in both
themes. Also not exercised: Samsung WebView compositing of a fixed, animated-opacity layer.

Also filed: **LB-130** — `docs/doc-size-baseline-history.md` is now the guaranteed-conflict file
that `.size` used to be, on the same append-to-one-shared-file shape LA-33 and RV-134 already
fixed twice. Measured across five re-merges of #1449 in an hour.

## The journal compaction sweep rode along, because the guard said it was mine

Merging `main` took `docs/overview/entries/` past the 60-foldable runaway limit, and since BF-36
that guard fails only a branch that **adds** an entry — which every feature PR does, so it lands on
whoever is holding the door. `node scripts/fold-journal-entries.js` folded **40 entries** into
`history-2026-09-23-folded-1.md`, rewriting citations in three durable docs
(`projectOverview.md` and the heart-rate and readiness domain indexes). Six were held back because
an agent baton cites them; rewriting another lane's live state file races whatever that lane is
doing.

Verified the way the README insists on rather than by reasoning about which links moved:
`check-doc-links` OK across 823 files, `check-index-doc-paths` OK across 1,176 paths. The second
one matters because it catches the trap the first cannot see — a citation whose link *text* is also
the path, where repointing the target leaves the backticked text naming a file that no longer
exists.

Folded the full 40 rather than the minimum needed to clear the limit: a sweep across N files is
already a batch, and stopping at the threshold hands the same failure to the next PR within the
hour.
