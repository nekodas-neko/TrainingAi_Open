# 2026-09-14 — the AI card says what skipping Accept costs (BF-156)

**Branch:** `fix/accept-cost-disclosure` · **Lane B** · v1.456.3

## What it was

Owner: *"what happens if I dont select to apply the session? Its pretty easy to miss that button."*

There are two answers. `prescriptionDrivesLoad` splits the five phase actions:

| pending `phaseAction` | drives today's load? | skipping Accept costs |
|---|---|---|
| `stay` | yes | the phase decision only |
| `transition_recommended` | yes | the phase decision only |
| `deload_recommended` | **no** | the whole recommendation |
| `session_swap_recommended` | **no** | the whole recommendation |
| `rest_day_recommended` | **no** | the whole recommendation |

On the opt-in half, starting the workout without answering silently reverts to the program's base
progression style, and what is on screen is simply not what you train. This is live on the owner's
account now: `session_periodization` holds a pending `session_swap_recommended`.

## What the entry missed, and why it mattered

BF-156 says *"the card looks identical for both"*. It does not — and that is worse, because the way
it differs is misleading. The card has two action blocks, and **they split on a different axis than
the rule**:

- **"Move to …" / "Skip"** — `transition_recommended` and `deload_recommended`. One drives load, one
  does not.
- **"Accept" / "Dismiss"** — `stay`, `session_swap_recommended`, `rest_day_recommended`. One drives
  load, two do not.

So the buttons are not a signal in either direction. A reader who learned "the Move card means my
numbers are live" would be right for a transition and wrong for a deload. Fixing only the Accept
block, as the entry's wording implies, would have left the transition/deload pair unlabelled.

One `ConsequenceLine` component now renders in **both** blocks, reading `prescriptionDrivesLoad`
once from the shared module — never a second copy of the split. Muted grey on the driving half,
bold amber on the opt-in half, which is the one where doing nothing discards the advice.

The opt-in line is bold text rather than a second amber panel: the low-confidence warning already
owns that shape in the Accept block, and two stacked panels read as one thing to scroll past.

## Verification

`e2e/prescription-accept-consequence.spec.ts` seeds a pending prescription and swaps its
`phaseAction` in place, so both cases are the same card in different states. Both are from the
**Accept** block deliberately — same two buttons, opposite sentence, which is the claim.

Each test asserts the right line is present **and the other is absent**: a sentence that appeared in
both states would be worse than none, because it would read as a fact about the card rather than
about this prescription. Both tests fail against unpatched `components/` — falsified, not assumed.

`pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean · `deload-visible.spec.ts` still green
on the same seeded row.

## Not in scope

Per the entry: changing which actions drive load, and auto-applying the opt-in half. Both are the
owner's calls and neither is needed to make the button honest.

Also **not** done: making the opt-in half genuinely harder to scroll past — a blocking confirm, or
refusing to start until answered. The entry raises it and it is a real design change, not copy.

## What was NOT exercised

- **No device.** 412 dp in Chromium only. The owner's live `session_swap_recommended` is the case to
  look at, and it is the one this was written for.
- **`transition_recommended` and `deload_recommended` were not driven** — the two that share the
  "Move to …" block, and the pair that proves the axes cross. They take the same `ConsequenceLine`
  from the same boolean, so they are covered by construction rather than by test; the seeding cost
  is a `phase_mode` change plus a transition-eligible phase state, which the two Accept-block cases
  already establish the pattern for.
- **The bold-amber line was not checked against the low-confidence panel** stacked above it. That
  combination needs a low-confidence pending swap, which the fixture does not build.
