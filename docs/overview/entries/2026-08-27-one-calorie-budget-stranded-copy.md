# 2026-08-27 — `fix/one-calorie-budget-stranded-copy` — a copy change left one guard unable to fail

**Lane B · v1.393.1 · test-only.** No product file changes.

`e2e/one-calorie-budget.spec.ts` has been red on `main` since **#586** (BF-24 ②, `cc0555e7`) landed
the nutrition energy card. That PR rewrote the copy the spec asserts on and updated its sibling
`calorie-progress-bar.spec.ts` but not this one. Found on a full local run while verifying Q-112a —
93 passed, 3 failed, two of them these.

## Three stranded assertions, and the third is the one that mattered

| Asserted | Now rendered |
|---|---|
| `+718 from movement` | `+718 burned` in the header; "movement" moved to the zone-bar detail |
| `/295g` | `0/295 g` — `energy-card.tsx:225` renders the unit in its own span, with a space |
| `3196 left` | `3,196 kcal left` — the card formats with `toLocaleString()` |

Two of those fail loudly. **The third does not exist in that list** — it is the *negative* assertion
that closes the same test:

```ts
await expect(page.getByText(`/${BASE.carbsG}g`)).toHaveCount(0)
```

That line is the whole point of the test. It proves the ring draws Q-323's **earned-scaled** macro
targets rather than the stored ones — the defect being that a 551-kcal-earned day reported fat *over*
when it was well under. After the copy change nothing on the page matches `/NNNg` at all, so the
count is 0 whether or not the base target is on screen. **A guard that cannot fail is not a guard**,
and repairing only the two loud assertions would have turned the test green with that one
permanently vacuous — which is worse than red, because red gets looked at.

## What changed

- The header and detail are asserted **separately**, because each carries half of the original
  intent: the header proves the earned figure is on screen, and *"movement"* — not "cardio" — is the
  wording the test was written to pin, since the figure includes strength sessions and steps and this
  fixture's whole contribution is a strength session.
- The macro assertions go through one `/${grams}\s*g` helper, so the positives and the negative can
  never again drift apart on whitespace.
- `kcal left` is matched with an optional thousands separator built from the digits, **not**
  `left.toLocaleString()` — that resolves in the *runner's* locale and the browser's need not agree,
  which trades a red-here failure for a red-elsewhere one.

## Driven, not inspected

Reverting `targets={effectiveTargets}` to `targets={targets}` in `nutrition-content.tsx:587` fails
exactly one test — `the ring's macro bars use the scaled targets, not the stored ones` — and leaves
the other four green. That is the mutation the negative assertion exists to catch, and it is what
proves the repair restored it rather than just silencing it.

`e2e/one-calorie-budget.spec.ts` and `e2e/calorie-progress-bar.spec.ts` pass together, 7 of 7.

## The general shape, for the next copy change

A spec that asserts on a string has no link to the component that renders it, so a rename strands it
with no compiler or lint signal. `CLAUDE.md`'s sibling-surface rule already says to grep every
surface handling the same domain when changing a pattern — **specs are one of those surfaces**, and
`calorie-progress-bar.spec.ts` being updated in the same PR shows the sweep happened and stopped one
file short. The tell that it is worth grepping harder: this file's own name says it is about the same
card.

## Not exercised

- No product code changed, so there is nothing new to verify on device.
- The full E2E suite was not re-run for this change; the two specs covering the energy card were, plus
  the mutation above. `goal-invalidation.spec.ts` remains red locally for the unrelated aged-seed
  reason (it needs today's steps row; `max(date) WHERE steps IS NOT NULL` is 2026-08-25 here).
