# 2026-09-21 — motion-polish: a press state, and a sheet that opens like the rest of the app

**Lane B** · `fix/motion-polish-button-and-sheet` · **v1.463.0** · RV-71 + RV-75

Two one-line changes to shared primitives, and most of what is worth recording is about how they
were verified rather than what they say.

**RV-71.** `components/ui/button.tsx` had **no `active:` anywhere** — every variant was `hover:`-only
— across 129 importers, on a touch-only product. A finger cannot produce hover, and on Android
WebView `hover:` either never resolves or sticks after a tap, so the most-tapped control in the app
gave no feedback and could be left looking permanently highlighted. Meanwhile 45 files hand-rolled
`active:scale`, so the house pattern existed everywhere except the shared control.

`transition-all` was narrowed in the same change, which is not tidying: it animates `width`,
`height`, `padding` and `margin`, so any Button whose size changes — a label swapping to a spinner —
silently got a layout animation.

**RV-75.** The sheet ran on shadcn's stock 500 ms open, untouched. 47 files render one, against a
tab transition the repo deliberately cut to 180 ms with the comment *"the whole point of this app is
to feel instant"*. Now 300 ms open, 250 ms close, on the M3 emphasized-decelerate curve
`globals.css` already uses — not a second easing invented for sheets.

## The mistake that justifies the whole test approach

I wrote **`duration-250`**. It is not in Tailwind's default scale (75/100/150/200/300/500/700/1000),
so it compiled to **nothing** and left the stock 300 ms close in place.

A typo'd Tailwind class fails no gate. Not tsc, not lint, not the custom rules — the string is valid
JSX either way. It reads as a shipped fix and does nothing. That is why the spec asserts
`getComputedStyle` values rather than class strings, and why the control had to be run: the assertion
`sheet opens in 500ms — the stock 500ms default is still in place` is the only thing standing between
a working change and a convincing no-op.

## A second locator mistake, same shape

The Button spec first grabbed `page.locator('button').first()`, which on `/more` is some other
control carrying `transition-colors`. It failed loudly — but had the page happened to put a real
Button first, it would have passed while testing nothing. It now targets `[data-slot="button"]`.

**Both controls were run and both named the right defect**: *"the Button still transitions every
property"* and *"sheet opens in 500ms"*.

## The batch shipped in two pieces, deliberately

`motion-polish` names four entries. **RV-74 is genuinely `Gate: device`**, so the batch could not
ship whole in one PR regardless. **RV-72 is parked by its own emphasis glyph** — no `Gate:`, no
`Needs:`, just a `⛔` used for emphasis that `next-item.js` reads as the legacy blocker. That is
**LB-121's fourth measured instance**, and it is why RV-71 and RV-75 printed under READY while a
batch-mate printed under PARKED.

RV-72 was left out on a size judgement rather than the glyph: it is a new shared primitive plus ~33
conversions, and with `main` landing a PR every ~8 minutes against a ~7-minute check cycle, the
largest diff is the one least likely to land (#1365 took six merge attempts). It is next, and still
wants the same device pass.

## A queue error of mine, corrected here

**RV-81 was left in READY after it shipped.** I annotated the entry as `✅ SHIPPED` instead of
removing it — and since nothing was owed, the protocol is that it leaves the queue. It printed as
the top of READY on the next scan. `check-backlog-pointers.js` did not catch it because the ✅ was in
a bullet rather than the heading, which is the shape the check looks at. Removed.

## Verification

`e2e/rv71-rv75-motion-polish.spec.ts` — two tests, both asserting computed style: the Button's
`transitionProperty` excludes `all` and every layout property while including `transform`, at
≤120 ms; the sheet's `animationDuration` is ≤300 ms and its timing function is the app's shared
curve. Both proven red against the pre-fix primitives.

Gate: `Ran 75 of 75` Custom Rules · 7861 vitest passed, 0 failed · tsc clean · lint 0 errors.

## Not exercised

**How any of it feels**, which is the entire point of the batch. No sandbox drives a Samsung
WebView. The sticking `hover:` this guards against is a documented Android trait, not something
reproduced here. Both entries keep a device item.

**The sibling `transition-all` sites RV-71 lists** — `set-card.tsx:305`, `pre-workout-screen.tsx:342,351`,
and `home-sortable-section.tsx:26`'s `transition-[padding]` — are **not** done. Separate files,
separate risk; left rather than swept blind, and recorded on the entry.
