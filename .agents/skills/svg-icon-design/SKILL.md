---
name: svg-icon-design
description: Use this skill whenever choosing or creating an icon, illustration, badge, or visual symbol for the UI — empty states, achievement badges, activity types, navigation, card accents, info buttons, or anywhere an emoji character might otherwise be used. ALWAYS check this skill before writing an emoji character (🔥💪🎯🏆 etc.) into JSX — TrainingAI uses vector icon libraries and custom SVG for all iconography, never emoji.
---

# Custom Icons & SVG — No Emoji Rule

## Hard rule: no emoji as UI iconography

1.11.0 explicitly replaced emoji-based widget icons with Lucide vector icons across profile widgets and card corners. Emoji:
- Render inconsistently across Android/Samsung system fonts (different glyph shapes, sometimes fall back to monochrome or tofu boxes)
- Can't be recolored, resized cleanly, stroke-styled, or animated to match the app's design system
- Break the "one visual style across the entire app" principle from the mobile UI design skill

**If you're about to type an emoji character into JSX for anything other than literal user-generated content (e.g. echoing back a food name the user typed with an emoji), stop and find an icon instead.**

## Two icon libraries are already installed — check both first

- **`lucide-react`** — general UI icons: navigation, buttons, toggles, info (`<Info />`), actions. This is the default for most UI chrome.
- **`@phosphor-icons/react`** — broader coverage for domain-specific icons (sports, fitness, weather, food), including duotone/weight variants. `lib/constants/activity-icons.ts` is a good example: `ACTIVITY_ICONS: Record<string, Icon>` maps activity type keys to Phosphor icon components (`Barbell`, `PersonSimpleRun`, `SwimmingPool`, `Mountains`, etc.)

Search both libraries' exports for a matching icon before reaching for emoji or proposing a custom SVG — between the two, almost everything fitness/health/nutrition/weather related is covered.

## Building custom SVG (when no library icon fits)

For achievement badges, empty-state illustrations, or app branding not covered by either icon library:
- Inline SVG React component or `.svg` asset, sized via `viewBox` for crisp scaling at any size
- Use `stroke="currentColor"` / `fill="currentColor"` + Tailwind `text-*` color classes so the icon recolors with theme/accent — avoid hardcoded hex unless the color is intentionally fixed (e.g. `SET_COLORS`)
- For brand/accent-driven recoloring, prefer CSS variables (`var(--color-brand)`, `var(--brand-card-bg)`) over hardcoded values, matching `TimerRing`'s approach
- Animated icons (achievement unlock, celebration): drive with CSS `@keyframes` (see `motion-animations` skill — `pr-pulse`, `shimmer-sweep`) or `motion`, not GIF/Lottie — keeps bundle size down and themeable

## Samsung WebView compositor bug applies to icons too

Any new inline SVG icon added to a **home-screen card widget** can break sibling cards' gradient backgrounds in the Android APK. Apply Fix A (CSS-only shape, if the icon is simple enough) or Fix B (`willChange: 'transform'` on every sibling `accentCardStyle` card) — see `motion-animations` skill and the documented pattern in `projectOverview.md`.

## Icon picker UI

If a feature needs the user to *choose* an icon (e.g. custom activity types), follow `components/admin/activity-icon-picker-sheet.tsx` — a searchable grid over a curated `Record<string, Icon>` registry, not a free-text emoji input.
