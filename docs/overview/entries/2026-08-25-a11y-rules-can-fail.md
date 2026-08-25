# 2026-08-25 — the accessibility rules that ran and could not fail (Q-282, corrected)

**Branch:** `fix/a11y-rules-can-fail` · **Lane B** · `eslint.config.mjs` only. No product change,
no version bump.

## The entry's headline was false

Q-282 was titled *"no automated accessibility check exists anywhere in CI"*. One does.
`eslint-plugin-jsx-a11y` rides in through `next/core-web-vitals` and has been running in the Lint
job all along.

Verified by probe rather than by reading the config: a file containing `<img src="/x.png" />`
reports `jsx-a11y/alt-text`. The rule fires; the plugin is live.

**What was true is that it could not fail anything.** It reported at *warning*, so `pnpm lint`
exited **0** with violations present — and a new violation would land silently. That is precisely
how this repo's other counts drifted: the hex-literal total grew by **41 in five days** unnoticed,
because it was prose rather than a gate, which is why `check-hex-literals.js` exists.

## What shipped

Seven statically-decidable rules promoted from warning to `error`: `alt-text`,
`anchor-has-content`, `aria-props`, `aria-proptypes`, `aria-unsupported-elements`,
`role-has-required-aria-props`, `role-supports-aria-props`.

**Measured first: the whole app is at zero.** Scanning `app/`, `components/` and `lib/` produced
**0 jsx-a11y findings across 0 files**. So this costs nothing today and freezes the ground — a
shrink-only baseline whose baseline is *empty*, the strongest form of the pattern the repo already
uses for component size and hex literals.

Scoped deliberately to rules that are unambiguous and decidable without rendering. The noisier
label-inference rules are left as warnings; the entry itself predicted they would produce a large
initial backlog, and it was right to.

## Verified

- `pnpm lint` on the full repo: **0 errors, 124 pre-existing warnings**, exit 0 — the promotion
  breaks nothing.
- **Proved it can now fail**, which is the only thing that makes the change worth anything: a probe
  file with an unlabelled `<img>`, a `role="checkbox"` missing `aria-checked`, and a typo'd
  `aria-labeledby` reports **3 errors**. Probe deleted.
- Lint is a **required** check, so an error here blocks a merge.

## This does NOT close Q-282, and the entry is corrected rather than struck

**A linter cannot measure touch-target size or contrast** — the two things Q-282 actually names, and
the two the 2026-08-08 mobile sweep had to do by hand and could not complete (its contrast finding is
recorded in `projectOverview.md` as *"contrast that could NOT be measured"*). Both need a rendered
page. That half is still unbuilt.

**And its stated dependency has expired.** Q-282 says a scanner must ride on the Q-250 emulator job.
That was written 2026-08-15, before the Playwright E2E harness became a real running app in CI —
`@axe-core/playwright` against the existing E2E job would measure both rules on the same DOM the
WebView renders, with no emulator and no second harness.

**Not done here, deliberately.** It adds a dependency and a new failing-check surface; a flaky
accessibility gate would block every PR in the repo. Re-scoping an entry's approach *and*
implementing it in one pass is a decision that wants the owner or the Orchestrator, not an
implementer at the end of a long session. Recorded on the entry so the next person starts from it
instead of waiting for an emulator.

## Why this was worth doing today

This session hand-fixed three instances of exactly this class: Q-491's missing `aria-expanded`,
Q-281's colour-only score, Q-305's colour-only volume band. None of those seven rules would have
caught any of them — but the ones they *do* catch now cannot come back silently.

## Not exercised

Developer tooling; nothing device-related. The rules are static, so nothing about the rendered app
changed.
