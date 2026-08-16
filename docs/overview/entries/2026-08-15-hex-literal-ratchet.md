# 2026-08-15 — the theme-token rule gets a ratchet (Q-244)

**Branch:** `claude/ia-cluster-app-shell` · **No version bump** — CI and docs only.

Hex literals under `app/` + `components/` `.tsx`: **455** on 2026-08-07, **430** on 2026-08-09,
**471** on 2026-08-14 and still 471 today. CLAUDE.md recorded the trend as improving. It had
reversed — **+41 in five days** — and nobody saw it, because the line was prose and nothing measured
it between the two hand counts.

That is the whole finding. The two comparable rules that *do* hold — component size and the
`color-mix` hue bug — each have a shrink-only CI baseline, and that is the only structural
difference between them and this one.

## The check

`scripts/check-hex-literals.js`, in the Custom Rules job (**Ran 35 of 35** locally, up from 34).
Shaped like `check-component-size.js`, with a **per-file** baseline rather than a single total:

- A file not in the baseline must have **zero**. A new file that ships a literal fails immediately.
- A listed file may sit at or below its recorded count and may never grow.
- **A row for a file that reaches zero, or is deleted, must be removed** — the check fails until it
  is. Without that, the baseline decays into an allowlist that lets hex come back to a file someone
  already fixed. Same rule the sibling checks carry.

A single global total was the simpler option and is weaker: it lets one file grow while another
shrinks, which is exactly what "the trend looks fine" looked like on 2026-08-09.

**The regex is deliberately the one that produced the numbers above** — `#[0-9a-fA-F]{3,8}\b`, over
`.tsx` under `app/` + `components/`. It is a proxy and it over-matches: a `#1279`-style PR reference
in a comment counts. Keeping it identical is the point, because a baseline whose number cannot be
reproduced from a shell is a baseline nobody trusts:

```
grep -rhoE '#[0-9a-fA-F]{3,8}\b' app components --include=*.tsx | wc -l
```

The entry says explicitly **not** to sweep the existing 471 in this PR. The baseline is the
mechanism; the sweep is separate, optional and much larger.

## Mutation-verified three ways

A guard that has only ever passed proves nothing, and this one has three distinct failure paths:

| Mutation | Result |
|---|---|
| add `#abcdef` to a baselined file (`rhr-hrv-spo2-card.tsx`, 15) | fails — *16 hex literal(s), baseline 15* |
| add `#123456` to a file with **no** row (`ui/segmented-tabs.tsx`) | fails — *1 hex literal(s) — this file had none* |
| strip every literal from a baselined file (`ui/color-swatch-picker.tsx`) | fails — *Baseline row(s) to delete* |

Each reverted, and the check returns to `471 … none above baseline`.

## The CLAUDE.md line

Corrected to 471 with the date, and it now carries the reversal itself rather than just the current
number — a line that has been wrong in this specific way once should say so, or the next reader
takes the new number on the same trust that failed.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings) · `pnpm build` · **`pnpm check:rules` — Ran 35 of
35** · full suite green.

**Not exercised:** nothing device-shaped here — the change is one CI script, one workflow step and
two doc lines. No runtime code was touched, so there is nothing for the S25 to show.
