# projectOverview.md 13029 → 13033 — `fix/rv210-keyboard-and-viewport`, 2026-09-27

One Known-Issues row, four lines. It earns them by recording a negative that is easy to lose:
**every part of RV-210 is device-verifiable only**, and the harness cannot reach any of it — a
headless Chromium has no soft keyboard, so `interactive-widget` is inert and `dvh` resolves
exactly as `vh` (measured: 823.5 px at a 915 px viewport, 90% to the decimal).

Without the row, a later session reads "three fixes shipped, CI green" and takes the change as
verified. The row also flags `weight-dial.tsx`, which sizes from `window.innerHeight` and will
now shrink when a keyboard opens — the one place this change could bite something unrelated.
