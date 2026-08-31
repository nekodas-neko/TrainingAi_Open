# 2026-09-01 — the quantity box centres, and the reset it needed has one definition

**Branch:** `fix/bf-85-quantity-box-centring` · **Entry:** BF-85 · **Lane:** B · **Version:** v1.414.2

## The report

Owner, on the Assign to Meal step: *"the text for quantity doesn't look centered."* The input already
carried `text-center`, which is the tell — Chromium draws the inner spin button **inside** the box, so
the value centres in what is left and sits visibly left of true centre in a `w-20` field.

## What shipped

Two halves, because the box was wrong in two ways at once.

**The spinner reset**, now defined once as `NUMBER_INPUT_RESET` in `components/ui/input.tsx` and used
by both quantity controls.

**The font size.** `assign-step` styled the input `text-sm`, but `globals.css` sets
`input { font-size: 16px !important }` under 640px to stop iOS zoom — so on the S25 the class was
silently inert and the value rendered 16 px beside 14 px chips. That is the "differently
proportioned" half of the report, and `!text-sm` is what makes the class win, exactly as
`quantity-editor` already did with `!text-3xl`.

## The entry's recommendation was wrong, and the measurement is why

BF-85 said to *"put the pair on the shared input primitive rather than a third copy."* Reading the
call sites first showed why that would not work: **both quantity controls are bare `<input>`
elements, not the `Input` primitive** — and across the app only **1 of 28** `type="number"` inputs
uses the primitive at all. A fix living solely in the component would have reached almost nothing,
including its own reported site.

So the extraction is a **class constant** rather than a component change — which still satisfies the
standing rule (a pattern at two sites is extracted before a third copy) at the granularity that
actually reaches these call sites. The primitive gained the reset too, conditional on
`type === "number"`, because it costs nothing and anything converted later gets it free; that is one
site today and is not the point of the change.

**Both siblings were fixed, not just the reported one.** `quantity-editor.tsx` had carried the
hand-copy for months and now imports the constant, so there is one definition rather than two.

## One risk this refactor introduces, checked rather than assumed

Tailwind generates utilities by **scanning source for class strings**, so moving
`[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none` out of a `className` literal
and into a `const` in another file could in principle have stopped the CSS being emitted — and the
symptom would be the original bug, silently back. Confirmed against the built stylesheet that both
rules are still generated with the change in place.

## Verification

- `pnpm check:rules` — **Ran 67 of 67 Custom Rules steps** (the count moved 65 → 66 → 67 while this
  was in progress, twice from other agents' merges; it is read from the runner for exactly that
  reason). Full unit suite green, `tsc`, ESLint and the backlog check all exit 0.
- **Four source guards, all five mutations killed** — dropping the reset at either site, re-inlining
  the classes instead of importing them, dropping the `!` from `!text-sm`, and trimming the constant
  to `appearance:textfield` without the pseudo-element.
- **Two of those guards could not fail as first written, and mutation is what found it.** One matched
  the *import line* rather than the use, so deleting the class from the element still passed; the
  other matched its own explanatory comment, which contains `!text-sm`. Both now strip comments and
  imports before matching. **That is the fourth time this repo has shipped a guard satisfied by the
  prose documenting its own fix** — the helper carries that note so the next author sees it.

**Not exercised: the rendering.** Both vitest projects run `environment: 'node'`, so nothing renders
and the *effect* — a value that sits centred, in a box matching the chips' height and text size —
cannot be asserted here. That is the S25 check the entry asks for, and it has not been run.

## Left behind deliberately

**27 other bare `type="number"` inputs have no spinner reset.** Not swept: six are in admin and
device-debug consoles where a spinner is harmless or wanted, and the entry is explicit that a blind
sweep is the wrong move. The constant now exists for the next one that is reported, which turns each
into a one-line fix.
