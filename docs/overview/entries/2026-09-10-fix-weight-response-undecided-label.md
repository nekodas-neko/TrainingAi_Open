# 2026-09-10 — "not enough weigh-ins", printed above six of them (LB-99)

**PR:** `fix/weight-response-undecided-label` · **Lane B** ·
`components/nutrition/reta/weight-response-card.tsx`, `weight-response.ts`.

The second half of BF-136. Correcting the vial's opened date fixed the window and the owner's symptom
stayed: with six weigh-ins inside it, the chip still read *"Not enough weigh-ins yet"* — directly
above the card's own line reading *"6 weigh-ins over 5 days"*.

## Two opposite states shared one label

`weightResponse()` returns `null` only when there is genuinely no interval to compute: under three
readings, or no spread of days. It returns a **full result whose `verdict` is null** when there are
plenty of readings and the 95% interval straddles the band — which this card's own module doc calls
the designed normal state, *"grey with 'not enough weigh-ins yet' is the normal early state"*.

The chip was one expression:

```ts
{tone?.label ?? 'Not enough weigh-ins yet'}
```

so *undecided* rendered as *insufficient*. `responseState()` now separates the three cases and the
undecided chip reads **"Not called yet"**. Nothing about when a verdict is given changed — only what
the card says while it is withholding one.

## My first diagnosis was wrong, and the entry keeps it

When I filed LB-99 I named the `getLocalStore` fall-through and called this LB-98's first live
instance. It is not: `getLocalStore` returns null on web at `lib/local-store/index.ts:199`
(`isSQLiteAvailable()`), so the `cachedFetch` branch does run and the points did arrive. My own
ruled-out list should have implied it — the payload shape matched `WeightPoint` and the arithmetic
was already tested, which leaves the render.

The lesson is one this repo keeps relearning: **a card reporting "no data" is not evidence that no
data reached it.** Read what the component does with the data before suspecting the fetch. Q-278 and
Q-302 are the same class from the other direction — a value computed and then discarded by the
surface that asked for it.

## Verification

Unit: `responseState` is `insufficient` below three readings, `undecided` at six readings over five
days with `verdict: null` (BF-136's reproduced state, asserted as `weighIns === 6`), and `verdict`
once thirty days of steady loss commits. Plus a source guard that the label is picked from the state
rather than falling through to one string.

Rendered in the harness at 412 px against the reproduced state — six weigh-ins in the window, vial
dated five days back:

```
Weight response · since this vial
Not called yet
+0.54 kg/wk (95% CI −5.05 to +6.13, 5 days)
Your band is 0.41–0.81 kg/wk. The range crosses a boundary, so this is not called either way yet.
6 weigh-ins over 5 days. Weigh in more often to narrow this.
```

The old string is absent and the new one present. Database restored to its seeded rows afterwards.

**Not exercised:** the S25. This is WebView copy reached by a Railway deploy, but the card has not
been seen on the device, and the owner's own account is the only one with a real dosing period.
