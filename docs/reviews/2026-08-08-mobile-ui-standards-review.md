# Lens 10 — mobile UI against external standards, 2026-08-08

_Domain: `app-shell`. Lens 10 of
[`2026-08-09-deep-review-prompt.md`](2026-08-09-deep-review-prompt.md), following
[the running-app review](2026-08-08-running-app-review.md) (Step 0 + 1) and
[lenses 9 and 11](2026-08-08-claude-md-and-test-suite-review.md)._

Judged against **Material Design 3**, **WCAG 2.2 AA** and Android platform conventions — not against
this repo's own rules, which encode past bugs rather than everything good practice requires. Measured
in headless Chromium at 390×844 with a real logged-in session, both themes.

**Read §4 before quoting anything about contrast.** Contrast was **not** successfully measured, and
that is written up as a failed method rather than dressed up as a result.

---

## 1. Touch targets below the minimum

Material 3 specifies **48×48dp**; WCAG 2.5.8 (AA) requires **24×24 CSS px** for pointer targets.
Measured `getBoundingClientRect()` on every visible interactive element across ten screens:

| screen | control | rendered size |
|---|---|---|
| `/workout`, `/workout-select` | session carousel dot — `aria-label="Session 2: Pull"` | **7 × 7 px** |
| `/workout`, `/workout-select` | session carousel dot — `aria-label="Session 3: Legs"` | **7 × 7 px** |
| `/workout`, `/workout-select` | session carousel dot — `aria-label="Session 1: Push"` | **7 × 20 px** |
| `/sign-in` | "Create one" (registration link) | 66 × 14 px |
| `/` | "Download Android App" | 236 × 33 px |
| `/more` | unnamed icon button | 32 × 32 px |

**The carousel dots are the finding, and they are deliberate.** The app *has* a floor —
`app/globals.css:538-543` sets `button, [role="button"] { min-height: 48px; min-width: 48px }` under
`@media (max-width: 640px)`, with a long comment explaining why it is a bare element selector. The
dots opt out via `.tap-dense`, which at `:540-544` sets `min-height: 0; min-width: 0`. The opt-out's
stated purpose is *"controls that are intentionally dense (e.g. inline text buttons)"* — an inline
link inside prose, where a 48px floor would wreck paragraph layout.

**A carousel dot is not an inline text button.** It is a standalone control whose entire purpose is
to be tapped, and it ends up at 7×7 px — a third of the WCAG AA minimum and a seventh of Material's.

**Stated fairly:** WCAG 2.5.8 has an *equivalent alternative* exception, and one plausibly applies —
the carousel can be swiped. So this may pass the letter of AA while still being, at 7×7 on a 6.9"
display, effectively untappable. The fix is conventional and cheap: keep the dot 7px visually and pad
the hit area to 48px (`padding` plus a transparent box, or an `::after` overlay), which is what both
Material and iOS page indicators do.

Filed as **Q-160**.

## 2. Placeholder used as the only label (WCAG 3.3.2)

Three inputs have no `<label>`, no `aria-label` and no `aria-labelledby` — only a `placeholder`:

- `/sign-in` — `input[type=email]` placeholder `"Email"`
- `/sign-in` — `input[type=password]` placeholder `"Password"`
- `/chat` — `textarea` placeholder `"Ask about your training..."`

The placeholder disappears on focus, so the field's identity is gone exactly while the user is typing
into it — the failure mode WCAG 3.3.2 exists for. It also leaves screen readers announcing an unnamed
field. The sign-in pair is the worst placement: the first screen a new user sees.

Filed as **Q-161**.

## 3. Interactive controls with no accessible name (WCAG 4.1.2)

Six visible controls expose no name at all — no text content, no `aria-label`, no `title`:

| screen | element |
|---|---|
| `/nutrition` | `button.p-2.text-muted-foreground` |
| `/more` | `button.tap-dense.absolute` |
| `/overview` | `button.rounded-lg.p-1.5` |
| `/activity` | `button.rounded-lg.p-2.5` |
| `/chat` | `button.inline-flex.items-center` |
| `/chat` | `button.peer.data-[state=checked]:bg-primary` |

The last one is a **Radix Switch** — a toggle with state and no name, so a screen-reader user hears
"switch, on" with no indication of what it toggles. These are almost certainly icon-only buttons
where the icon carries the meaning visually and nothing carries it non-visually.

Q-133 (#1156) recently swept `aria-expanded` onto disclosure toggles; that was a different attribute
on a different control class, so this is not a duplicate. Filed as **Q-162**.

## 4. Contrast — NOT measured. Two methods, both wrong.

The prompt asks for contrast *computed, not eyeballed*. Two approaches were tried and **both produced
invalid results**. Recording the failures so the next attempt does not repeat them:

**Method 1 — resolve colours from `getComputedStyle`, walk ancestors for the background.** Produced a
tidy list of ten sub-4.5:1 labels on `/health`… **identical in light and dark**, which is the tell. The
theme genuinely switched (`documentElement.className` was `h-full light` then `h-full dark`), but
`body` computes to `rgba(0,0,0,0)` in **both** — this app paints its background through the
dynamic-background layer, not an opaque ancestor `background-color`. So the ancestor walk found
nothing opaque and fell back to assumed white in both themes. **Every one of those ten numbers was
measured against a background that never renders.** They are not reported here.

**Method 2 — sample the rendered pixels** under each text element's bounding box from a screenshot.
Returned **exactly 1:1 for every element in both themes**, which is impossible for visible text — a
uniform region, so the sampled coordinates are not landing on the text. Not diagnosed further.

**What a working method probably needs:** screenshot-based sampling is right in principle, but it must
verify non-uniformity before trusting a region, account for `deviceScaleFactor`, and confirm the
capture and the `getBoundingClientRect()` coordinates share an origin. Alternatively, disable the
dynamic background layer so real `background-color` values resolve, then Method 1 works — at the cost
of measuring something slightly different from what ships.

**Consequence for this review:** contrast is **unmeasured**, in both themes. The `DetailHero`
hardcoded-dark case that CLAUDE.md flags remains unverified. This is the largest gap in Lens 10 and it
is not closed.

## 5. Not covered

Also part of Lens 10 and **not** done: `prefers-reduced-motion` handling (the app has bounce, marquee,
confetti and ring animations); Android text-scaling at maximum; keyboard/focus-order traversal; error,
empty and loading states per screen; destructive-action confirmation; numeric `inputMode` on number
fields. No device — everything above is headless Chromium at a phone viewport, which does not test
Samsung's WebView compositor, real safe-area insets, or actual touch.
