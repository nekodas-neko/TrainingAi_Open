# 2026-08-08 — Lens 10: mobile UI against Material and WCAG, and a contrast measurement that failed twice

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domain:** `app-shell`

## What this was

Lens 10 of the deep review, after [Step 0 + 1](2026-08-08-running-app-review.md) and
[lenses 9 and 11](2026-08-08-claude-md-and-test-suite-lenses.md). Judged against **Material Design 3
and WCAG 2.2 AA** rather than this repo's own rules — those encode past bugs, not everything good
practice requires. Measured in headless Chromium at 390×844 with a real logged-in session.

## The finding worth arguing about

**The session carousel dots on `/workout` and `/workout-select` are 7×7 px.** Material 3 specifies
48×48dp; WCAG 2.5.8 AA specifies 24×24 px.

What makes it interesting is that it is deliberate. The app **has** a floor — `globals.css:538-543`
sets `min-height/min-width: 48px` on every `button` and `[role="button"]` under 640px, with a long
comment defending the bare element selector. The dots opt out through `.tap-dense` (`:540-544`,
`min-height: 0; min-width: 0`), and that opt-out's stated purpose is *"controls that are intentionally
dense (e.g. inline text buttons)"* — a link inside prose, where a 48px floor would wreck layout.

**A carousel dot is not an inline text button.** The opt-out was written for one thing and is being
used for another, and the result is a control whose entire purpose is being tapped, at a seventh of
the recommended size.

Stated fairly, because it matters: WCAG 2.5.8 has an *equivalent alternative* exception and the
carousel is swipeable, so this may pass the letter of AA. It still fails the intent on a 6.9" phone.
The fix is conventional and visually invisible — keep the dot 7px, pad the hit area to 48px, which is
what Material and iOS page indicators both do.

## Two more, straightforward

**Q-161** — three inputs (`/sign-in` email, `/sign-in` password, `/chat` textarea) use a placeholder
as their only label. It disappears on focus, so the field's identity is gone exactly while the user
types into it. The sign-in pair is the first screen a new user sees.

**Q-162** — six visible controls expose no accessible name at all. One is a **Radix Switch**, which
announces "switch, on" with no indication of what it toggles.

## The part I could not do, and why it is written down

**Contrast was not measured.** The prompt asked for it computed rather than eyeballed; I tried twice
and both methods were wrong.

**Method 1** — resolve colours via `getComputedStyle`, walk ancestors for the background — produced
a tidy list of ten sub-4.5:1 labels on `/health`, **identical in light and dark**. That identity is
the tell. The theme genuinely switched (`documentElement.className` went `h-full light` →
`h-full dark`), but `body` computes to `rgba(0,0,0,0)` in *both*, because this app paints its
background through the dynamic-background layer rather than an opaque ancestor `background-color`.
The walk found nothing opaque and fell back to assumed white in both themes. **Every one of those ten
numbers was measured against a background that never renders**, so none is reported.

**Method 2** — sample rendered pixels under each element's bounding box — returned exactly **1:1 for
every element**, which is impossible for visible text. A uniform region, so the coordinates are not
landing on the text.

Two broken methods is a signal to stop and report, not to keep tweaking. What a working attempt
probably needs is in §4 of the review: verify non-uniformity before trusting a sampled region, account
for `deviceScaleFactor`, confirm the screenshot and `getBoundingClientRect()` share an origin — or
disable the dynamic background so Method 1's assumption becomes true, at the cost of measuring
something slightly different from what ships.

**Consequence:** contrast is unmeasured in both themes, and the `DetailHero` hardcoded-dark case
CLAUDE.md flags is still unverified. That is the largest open gap in Lens 10.

## Not covered

Also part of Lens 10 and not done: `prefers-reduced-motion` (the app has bounce, marquee, confetti and
ring animations), Android text scaling at maximum, keyboard and focus order, per-screen error/empty/
loading states, destructive-action confirmation, numeric `inputMode`. No device — headless Chromium at
a phone viewport does not test Samsung's WebView compositor, real safe-area insets, or actual touch.
Lens 12 (multi-user scale) remains unstarted.
