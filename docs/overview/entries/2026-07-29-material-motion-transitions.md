## 2026-07-29 — Screen motion moved to Material shared-axis Y; back was never animated at all

Owner: *"I don't think the sideways transition is working well. maybe have it pull up (upward
transition) like an android page. and some sort of subtle transition on the tab navigation page —
what's the standard?"*

### What the standard is

Material 3 splits navigation motion by **relationship**, not by screen:

| Relationship | Pattern | Where it applies here |
|---|---|---|
| Deeper into a hierarchy | **shared axis Y** — vertical translate + cross-fade | any full-screen route push |
| Peer destinations | **fade-through** — fade + subtle scale-up, no direction | the five bottom-nav tabs |

The previous implementation had this backwards for a WebView shipped as an Android app: it used a
full-width **horizontal** slide (an iOS push) for hierarchy. On Android, lateral motion means *peer*
— pager pages, tabs — so a sideways push asserts the wrong relationship.

### Change 1 — shared axis Y for route pushes

`ta-slide-from-right`/`-to-left`/`-from-left`/`-to-right`/`ta-fade-out` are gone, replaced by
`ta-axis-y-in`/`-out` and their `-r` reverses. 200 ms, 30 px displacement (M3's 30 dp), M3's
emphasized easing pair — decelerate for what arrives, accelerate for what leaves. Both properties
animated are `transform` and `opacity`, so it still composites.

The z-index rule inverted with it. The old parallax needed the outgoing snapshot **above** the
incoming one; a cross-dissolve needs the opposite, or the arriving screen emerges from beneath a
screen that is still opaque.

There is a practical reason beyond convention, and it is probably the one the owner was feeling: a
100%-width slide has to stay legible across the entire screen width for its full duration. A 30 px
one does not. If the incoming screen is a few frames late to paint — which is the standing condition
in this app — there is far less travel over which that can show.

### Change 2 — back was never animated

Found while verifying, not reported: **no `back()` call site in the codebase used the transition
router.** Forward pushes animated (26 files use `useTransitionRouter`), every back cut instantly. So
a detail screen animated open and then snapped shut.

The reach here is one shared hook: `lib/hooks/use-back-or-fallback.ts` backs `DetailHero`, which is
all four health pillar screens — the exact screens the owner called out earlier as feeling worst
("especially towards the 4 pillar cards (sleep etc)"). Switched to `useTransitionRouter`; its
`replace(fallback)` to a tab href stays instant, since the hook already draws that line.

Then the sibling sweep, per CLAUDE.md: the other eight `router.back()` sites (admin, public profile,
health timeline, session-explain ×2, year-review, pre-activity, pre-workout) all moved too.
`useTransitionRouter` returns `{...router, push, replace, back}`, so each is a one-line swap.

### Change 3 — fade-through for tabs

Was `opacity: 0.35 → 1` over 120 ms, which is close to invisible. Now a real fade-through:
`opacity 0 → 1` plus `scale(0.96) → 1` over 180 ms on M3's decelerate curve, with opacity finishing
at 60% so content is readable before the motion stops.

Two deliberate deviations from spec, both toward speed: spec scales 92% → 100% over 300 ms; 92% on a
full-screen panel reads as a zoom rather than a settle, and 300 ms defeats the point of the app.

Not shared-axis, on purpose — axis motion asserts a direction between screens, and five tabs have no
order to assert.

### Verification

`pnpm tsc --noEmit` clean, `pnpm lint` 0 errors (119 pre-existing warnings), `pnpm build` succeeds —
the build is the check that matters for the eight converted files, since `useTransitionRouter` calls
`useSearchParams()` and that forces a Suspense boundary on any statically-prerendered page. All
affected routes are dynamic (`ƒ`); nothing regressed.

Browser-verified in Chromium at a 412×915 viewport, signed in, on the owner's exact reported flow
(Health → Sleep and back), sampling `document.getAnimations()` across the animation window rather
than at the instant the attribute flips — the `::view-transition-*` pseudo-elements do not exist yet
at that instant, which made a first attempt read as a false negative:

```
FORWARD : dir=forward  ta-axis-y-in ::view-transition-new(root)
                       ta-axis-y-out ::view-transition-old(root)     → /health/sleep
BACK    : dir=back     ta-axis-y-in-r ::view-transition-new(root)
                       ta-axis-y-out-r ::view-transition-old(root)   → /health
TAB     : ta-tab-enter 0.18s
```

The back leg is what proves change 2: before the hook swap the same probe recorded an empty
sequence — no transition fired at all.

**Not verified on device.** Chromium is not Samsung's WebView, and the whole reason this animation
uses the View Transitions API rather than Framer Motion is a compositor difference CLAUDE.md
documents but the sandbox cannot exercise. Whether 200 ms / 30 px feels right on the S25 is the
owner's call, and both numbers are one-line changes in `globals.css`.

### One known cosmetic caveat

`session-select-content.tsx:971` renders the Home meteors as `fixed inset-0` **inside** a tab panel.
A transform on an ancestor makes a fixed child position against that ancestor, so during the 180 ms
tab animation that layer is inset by ~2% (~8 px per edge). It is a `pointer-events-none`,
30%-opacity decorative particle field, so this should be imperceptible — but it is a real
consequence of adding `scale()` to the panel, and it is written down here rather than discovered
later.
