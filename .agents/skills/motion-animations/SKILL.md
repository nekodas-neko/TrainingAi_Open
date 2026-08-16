---
name: motion-animations
description: Use this skill when adding or adjusting any animation, transition, drag interaction, or micro-interaction — using the `motion` (Framer Motion) library, CSS @keyframes in app/globals.css, or inline SVG <animate>. Also trigger when the user asks for something to "animate", "pulse", "bounce", "slide", "fade", "celebrate", "drag to reorder", or describes a visual effect tied to a state change (timers, completions, achievements, drag-and-drop).
---

# Animation & Micro-Interaction Patterns

## Library choices (don't hand-roll what's already installed)

- **`motion`** (Framer Motion v12) — layout animations, gesture-driven transitions, exit/enter animations
- **`@use-gesture/react`** — custom pointer/drag gesture handling
- **`@dnd-kit/react`** + **`@dnd-kit/dom`** — drag-and-drop reordering (program editor sessions/exercises, home screen widgets)
- **`canvas-confetti`** — celebratory bursts (PRs, achievements)

Before writing raw `onPointerDown`/`onPointerMove` handlers or a custom drag implementation, check whether `@use-gesture/react` or `@dnd-kit` already covers it.

## Existing animation vocabulary — match these, don't reinvent

| Name | Where | Effect |
|---|---|---|
| W1 — `animate-bounce` | Start button during `workoutPhase === "rest"` | Tailwind built-in bounce draws attention to the next action |
| W2 — `border-run` keyframe (`app/globals.css`) | Active set card during `workoutPhase === "set"` | SVG `<rect>` `stroke-dasharray`/`stroke-dashoffset` traces the card border; uses `pathLength=1000` normalization so the keyframe is size-independent |
| TimerRing pulse | `components/workout/timer-ring.tsx` | SVG `<animate attributeName="stroke-opacity">` pulses the active ring segment |
| `xp-pop` | XP gain toast | Scale+fade-in pop, Peak-End Rule "small win" feedback |
| `pr-pulse` | New personal record | Expanding box-shadow ring pulse |
| `shimmer-sweep` | Newly-unlocked achievement badge | Diagonal light sweep, draws the eye once |
| `ta-marquee` | Muscle recovery strip | Continuous auto-scroll, no user input needed |
| `meteor`, `twinkle`, `cloud-drift`, `rain-fall`, `snow-fall`, `fog-drift`, `lightning-flash` | Dynamic background weather layers | Each is a self-contained particle/sky effect, composed per weather condition |

When adding a new celebratory/feedback animation, reuse one of `xp-pop`/`pr-pulse`/`shimmer-sweep` if the *meaning* matches (small win vs. milestone vs. one-time unlock) rather than inventing a fourth style.

## The Samsung WebView compositor bug

**Any inline SVG inside a home-screen card widget** can break sibling cards' `linear-gradient`/`rgba()` backgrounds in the Android APK (Samsung WebView), even though it renders fine in the Chrome PWA. If your animation adds an SVG (icon, ring, chart) to a home screen card:
- **Fix A (preferred)** — replace the SVG with pure CSS (`conic-gradient` + `mask`/`WebkitMask` for donut/ring shapes)
- **Fix B** — if the SVG must stay (e.g. a Lucide icon), add `willChange: 'transform'` to **every** sibling card using `accentCardStyle`, promoting each to its own GPU compositor layer

Never add a new inline-SVG home-screen card without applying one of these.

## Performance & accessibility

- Animate `transform`/`opacity` only on home-screen widgets — animating `width`/`height`/`top`/`left` causes layout thrash on lower-end devices
- For purely decorative continuous animations (dynamic background, marquee), respect `prefers-reduced-motion`
- Keep animation durations consistent with existing ones (`border-run` ~ rest/set duration, pulses ~1.6s) — new one-off durations should feel like they belong to the same system
