## 2026-09-08 — An on switch is brand-coloured, not near-white (LB-61)

**Branch:** `fix/lb-61-switch-brand-on` · **Lane B**

### What shipped

Two tokens in `components/ui/switch.tsx`. The on state is `--brand`; the thumb is
`--brand-foreground`.

In dark — the only theme this app ships — `--primary` is `oklch(0.922 0 0)`: near-white with **zero
chroma**, the shadcn light-first default. That is the same value that made BF-124's selected role
pill read as switched off, and it made every on switch read as an inert slab rather than a chosen
state. `--brand` is overridden at runtime by the owner's own colour, so the switches follow it
instead of being a greyscale island, and `--brand-foreground` exists precisely to stay legible on a
`--brand` fill.

### The decision, and how it was taken

LB-61 asked for a count before anyone proposed anything. That was done first (#952): **25 switches
across 14 files**, split roughly 15 persisted preferences to 10 in-form choices — a real split that
**does not decide anything**, because nobody classifies a toggle before looking at it. Two on-colours
would be a distinction the user has to learn in order not to be confused by it.

The recommendation and the argument against it both went to the owner, who chose the recommendation.
The argument against is not discarded: five brand-green pills in the `settings-panel.tsx` column may
read as loud, and green in this app already means *good / achieved* rather than *enabled*. That is
what the device check is for, and the fallback (brand for in-form, neutral for settings) is recorded
on the entry rather than left to be re-derived.

### Verification, and what it is not

**Not rendered-verified locally, and the reason is worth carrying.** No switch is reachable on this
seed: the Goals AI sheet needs `GOOGLE_GENERATIVE_AI_API_KEY`, which the sandbox lacks, and the
`more/settings-panel.tsx` collapsible produced no `[data-slot="switch"]` in 24 seconds of polling
after its row was expanded. Four scripted attempts went into it before that was accepted rather than
worked around.

What *was* verified is the thing a token swap can actually get wrong — that the tokens resolve. From
the compiled CSS after `pnpm build`:

- `.bg-brand{background-color:var(--color-brand)}`
- the dark `[data-state=checked]` thumb rule resolving to `--brand-foreground: oklch(100% 0 0)` —
  pure white, which is the standard legible pairing on a mid-dark green track.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · `pnpm build` exit 0 ·
full unit suite green.

**LB-61 stays in the queue as `Verify: device`** rather than being removed — 25 controls changed
appearance at once and nobody has looked at one. That is a look owed, not work owed, which is exactly
what that field is for.

Patch bump — user-visible.
