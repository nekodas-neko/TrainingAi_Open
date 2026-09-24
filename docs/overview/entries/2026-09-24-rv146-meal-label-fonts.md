# RV-146 — two fonts nobody on the page uses, and the reason the obvious fix was wrong

**Branch:** `fix/rv146-meal-label-fonts` · **Entry:** RV-146 (shipped, device check owed) · **Version:** unchanged

## What was wrong

`app/layout.tsx` loads `Archivo` and `Instrument_Serif` for Q-389's printable meal label and nothing
else. `next/font/google` preloads by default, so every cold start on every screen fetched both faces
before first paint and Chromium logged *"preloaded using link preload but not used within a few
seconds"* four times per visit — Review counted that across ten visits on the S25.

`display: "swap"` was already there and the code comment explains it correctly: swap keeps these off
the **render** path. It does nothing about the **network** path, which is what was being paid for.

## Why the entry's own fix would have shipped a silent fallback

The entry proposed `preload: false` and no more, reasoning that the renderer already awaits
`document.fonts.ready` so the faces would still arrive in time. I measured it in Chromium before
changing anything, and that reasoning does not hold:

| after | `document.fonts.check('700 12px "Archivo"')` |
|---|---|
| `await document.fonts.ready` | **false** |
| `await document.fonts.load('700 12px "Archivo"')` then `ready` | **true** (1 face loaded) |

`fonts.ready` settles loads that are **pending**; it does not **start** one. A webfont is fetched
lazily, when something rendered uses it — and nothing on the page renders in these faces, because
the only consumer draws to a canvas. So with the preload gone the fetch would never begin, `ready`
would resolve against a font set that does not contain the face, and `ctx.font` would fall back
without raising anything. That is precisely the silent substitution the existing await was written
to prevent.

So the fix is both halves: **no preload, and the renderer asks for the face by name before it
waits.** `meal-label-render.ts` now loads each weight it draws with (400, 500, 700 — checked against
every `ctx.font` in the file) and then awaits readiness. `document.fonts.load` is given the bare
first family rather than the whole list: measured, the bare form reports 1 face loaded, the full
list reports 0 while still loading it, and the unambiguous form is the one worth shipping.

## The older defect the probe walked into

Reading the family back is done by `resolveFamily`, and it read
`getComputedStyle(document.documentElement)`. `app/layout.tsx` sets every `next/font` variable on the
**body** class, and a CSS custom property inherits downward only. Measured on `/nutrition`:

```
on <html>:  --font-geist-sans ""  --font-geist-mono ""  --font-archivo ""  --font-instrument-serif ""
on <body>:  "Geist, …"            "Geist Mono, …"       "Archivo, …"       "Instrument Serif, …"
```

All four empty. `resolveFamily` therefore returned its generic fallback for **every** style, so the
printable label has never drawn in any of its four intended typefaces — not Archivo, not Instrument
Serif, and not Geist or Geist Mono either. It is a one-word fix (`document.body`) and it ships here,
because without it the explicit font load this change adds is loading a family nothing asks for.

This is the fourth entry in a row whose stated cause was not the whole cause. Reading the code — and
here, running the browser — before accepting the entry keeps paying.

## Verification

- **Browser-measured**, three probes, not committed: the variable resolution above; `check()` false
  after `ready` and true after `load`; and the family-list vs bare-family difference.
- New `components/nutrition/__tests__/rv146-label-font-loading.test.ts`, 4 tests, **control-run
  against `origin/main`: all 4 red**. It pins the pair together — no preload, load before ready,
  every drawn weight declared, and the family read off `document.body`.
- `components/nutrition/__tests__`: 38 files, 341 tests green. `e2e/meal-label.spec.ts`: 6 passed,
  including the all-styles render.
- `pnpm check:rules` **Ran 77 of 77**, all passed. `tsc --noEmit` clean.

**Not exercised:** the S25, which is what the entry's own pass test asks for and why it stays queued
with a `Keep:` under `Lane: DV`. The sandbox can read a font set; it cannot read the device's
cold-start FCP (1020 ms at sweep 1), and the four console warnings need a real cold start to confirm
gone. Samsung WebView rendering, safe-area and drifted production data untested. The label's printed
output was checked by the e2e render, not by eye on paper.
