# 2026-09-22 — RV-100: a training phase painted in the state colours

**Branch:** `fix/rv100-deload-colour` · **Lane:** Implementation B · **Version:** 1.465.5

## What shipped

`PHASE_COLORS` in `ai-periodization-status-card.tsx` mixed two colour languages:

- **`realisation: "text-red-500"`** — the *peak-output* phase, in the app's failure colour.
- **`deload: "text-green-500"`** — while Home's `DeloadBanner` paints a deload *recommendation*
  `#ef4444` / `#f97316` / `#fbbf24` by strength.

The five phases now use a cool ramp — `baseline` neutral, then blue, indigo, purple, cyan — so
green, amber and red are left to mean state. Home's banner also carried a **third** amber beside
`#f59e0b` and `--accent-amber`; the soft tier takes the token now, and `check-hex-literals.js`
drops that file 3 → 2.

## The open question, answered before sizing the work

The entry says to establish whether both surfaces are actually reachable — *"if the phase card only
shows `deload` while the banner is suppressed, the collision is theoretical."* Measured against
production: the active program **is** `ai_dynamic`, so the card renders, and
`session_periodization` carries **2 sessions in `deload` and 2 in `realisation`** right now. Both
are live.

## The entry's suggested fix would have moved the collision, not ended it

RV-100 says to *"give `PHASE_COLORS` a non-semantic set (`packages/shared/src/session-palette.ts` is
already the repo's categorical palette)"*. **That palette contains `green` and `red`.** It is
indexed by session *position*, so borrowing it would have assigned a phase whichever hue its index
landed on — including the two reserved ones. A cool ramp chosen explicitly against the state hues is
what the entry wanted; its named source is not it, and the test asserts that palette still carries
green and red so the suggestion cannot be quietly retried.

## A distinction the entry overstates, kept in mind rather than acted on

The entry frames the two surfaces as the same concept — *"neither is wrong alone; the pair cannot
both be right."* They are not quite the same thing: the chip is a **program phase** (this session is
in its deload block) and the banner is a **recommendation** (you have trained eight days running,
rest). Green for "you are in the easy week" and amber for "you should take one" can both be correct
readings. What is *not* defensible is a category borrowing the state language at all, which is why
the fix still stands — and `realisation` in red needs no such argument.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean.
- **Controlled: 3 of the test's 4 cases go red** against the unfixed files. The fourth characterises
  `SESSION_PALETTE` and correctly does not move; it exists to stop the entry's suggestion being
  retried.
- The assertions parse the `PHASE_COLORS` object body rather than grepping the file, and fail loudly
  if that parse returns nothing — a passing vacuous assertion is the failure mode here.

**Not exercised:** no device sitting. This is a hue change on two surfaces and wants an eye on the
S25 — particularly whether indigo and purple read as distinct at chip size.
