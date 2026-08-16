# 2026-08-09 — Names for the controls that only had pixels

**Branch:** `fix/accessible-names-wcag` · **Q-161 + Q-162** · **v1.276.2**

Two entries, one defect in two shapes: a control whose meaning is carried entirely by what it looks
like.

- **Q-161** — three fields with a placeholder as their only label. It vanishes on focus, so the field
  loses its identity exactly while it is being typed into, which is the failure WCAG 3.3.2 exists
  for. The sign-in pair is the first screen a new account sees.
- **Q-162** — icon-only controls announced as "button" and nothing else.

## The review's list was checked, not applied

Q-162 named six selectors from a live DOM scan. **Two were false positives.** The chat `Switch` is
named by its `<label for="speak-aloud">`, and the dumbbell button by its `title` — both give an
accessible name, and the scan had looked only for `aria-label`/`title`/text.

So the names were measured instead, in a real browser across seven pages, computing the common
branches of the ARIA name algorithm — including `<label for>`, an ancestor `<label>`, and
`aria-labelledby`. That found the genuine ones, and one the review never saw because the page did
not exist when it ran: **the Coach composer's textarea**.

My own first pass then over-reported: it counted the `aria-hidden`, `tabindex="-1"` checkbox Radix
Switch ships for form submission, which is not in the accessibility tree at all. Excluding
`aria-hidden` subtrees is what made the numbers trustworthy.

Final state, measured: **0 unnamed on all seven pages.**

## The durable half

`scripts/check-icon-button-names.js`, wired into **Custom Rules**. It reads JSX, so it is a
heuristic — and deliberately a narrow one. It flags only a button whose entire body is a single
self-closing icon element and which carries no naming attribute. A button containing text, an
expression, or anything else is left alone, so a name coming from a `<label for>`, a child span or a
prop cannot be misread as missing.

**Under-reporting is the intended failure mode.** A check that cries wolf gets exempted into
uselessness; the browser pass is what catches what this cannot see.

It found **nine more** on screens the browser pass never reached — two admin managers, the
scroll-to-bottom button, a drag handle, three back arrows, a builder send button. All fixed, so it
ships with **no grandfather list**. Verified in both directions: planting the defect back into
`warmup-screen.tsx` exits 1 and names the line.

## Two files tipped the size limit

`chat.tsx` (801) and `more/profile-tab.tsx` (850, baseline 849) went over on a single added
attribute line. Folded onto existing lines rather than extracting — extraction is the answer for a
feature, not for an `aria-label`.

## Verification

426 files / **3411 tests** green · `pnpm build` compiles · lint + all 15 custom-rules scripts pass ·
live accessible-name audit clean on `/sign-in`, `/nutrition`, `/more`, `/overview`, `/activity`,
`/chat`, `/coach`.

**Not exercised: a real screen reader.** Names were computed from the DOM, not heard from TalkBack on
the S25 — the wording of each label is a judgement call that a device pass could still improve.
