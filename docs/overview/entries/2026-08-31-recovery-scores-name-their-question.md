# 2026-08-31 — Readiness and Body Battery each say which question they answer

**Branch:** `fix/recovery-scores-name-their-question` · **Entry:** Q-276 · **Lane:** B · **Version:** v1.413.0

## The finding, and why it was not a modelling bug

Measured over 31 post-re-key days:

| pair | r | n |
|---|---|---|
| Readiness ↔ Body Battery **anchor** | +0.93 | 31 |
| Readiness ↔ Body Battery **end value** | **+0.12** | 31 |

The anchor correlates at +0.93 because it *is* readiness. By end of day that has decayed to +0.12 —
and the two numbers sit one directly above the other on Home, both read as *"how recovered am I"*.

The owner settled it in 2026-08-19 rather than picking a winner:

> *"Body battery should be more like 'how much energy I have left'. Readiness should just be a
> starting number based on your previous day + sleep, so you can see how your day is typically based
> on data."*

**Two different questions, not one question answered twice.** That makes it a presentation contract,
which is why it was Lane B's rather than Lane A's. And **readiness needed no model change to match
the definition** — all nine `READINESS_WEIGHTS` contributors are overnight or previous-day measures
(`previousNight`, `restingHeartRate`, `hrvBalance`, `temperature`, `sleepBalance`, `checkin`,
`prevDayActivity`, `recoveryIndex`, `activityBalance`). Nothing reads today's activity. It was
already the number the owner described; nothing said so.

## What shipped

**`components/body-battery-card.tsx`** — one line under the collapsed headline: *"Energy left right
now — opens at your readiness and drains as you use it."*

**The card already said this, and better.** The problem was where: the explainer lives in the
expanded body **and renders only when `battery.hasData` is false**. So it is one tap away *and*
gated on the empty state — on any ordinary day, with data, nobody has ever read it. Two reasons
nobody sees a line is one too many.

**`components/health/health-score-detail.tsx`** — a `subtitle` slot under the hero, and
**`app/health/readiness/readiness-content.tsx`** fills it: *"How your day is likely to go, set this
morning from last night's sleep and yesterday. It does not move as you use energy — that is Body
Battery."*

The second sentence is the load-bearing half. *"A morning number"* on its own does not stop a reader
taking it for the live one; saying what it is **not**, and naming what is, does. And it is a checked
property of the model rather than a simplification for the reader.

## Where the framing sits, and why not on Home

The obvious move — a paragraph on Home explaining the pair — was not taken. Home is the densest
screen in the app and the score chip row has **eight** ring-style layouts, three of which (pill,
rail, minimal) have no room for a subtitle at all; adding one would mean touching every layout and
would still fail in half of them.

Instead the battery card carries its own line, and the card sits **directly under the readiness
chip**. So the disambiguation is at the exact point of adjacency Q-276 names, at no cost to the
layout, and readiness's own framing is one tap away on its detail screen — the same distance
Body Battery's used to be, except now it renders.

## Verification

- `pnpm check:rules` **Ran 65 of 65 Custom Rules steps**, all passed. Full unit suite green.
- **`e2e/recovery-scores-name-their-question.spec.ts`**, two cases, **both mutation-checked**: the
  battery line is visible on Home with a **data-carrying** battery (the state whose framing was
  missing — the spec stubs `/api/body-battery` with `hasData: true` precisely so it cannot pass off
  the old empty-state explainer), and the readiness subtitle is visible *including its distinguishing
  clause*. Deleting either line fails its own assertion.
- One thing the spec had to be taught: the chips and the battery card render on **`/`**, not
  `/session-select` — the Workout tab shares the component without them. A spec pointed at the wrong
  tab passes its stub and finds nothing.

**Not exercised:** the S25. This is copy inside an existing card and an existing detail screen, so it
is not in any of the device-gated categories (offline-first, native plugin, safe-area, gestures,
notifications) and does not earn a Known-Issues row — but the two lines have been read at the 412 px
viewport in Chromium only, not on the phone.

## What this does not do

- **It does not change either model.** Q-272 (Body Battery drains 5× faster than it charges) is
  untouched and still open; so is the drain model folded into Q-521.
- **The +0.12 is no longer a defect to fix.** Two numbers answering different questions are not
  required to agree — the original framing assumed they should. What is still worth watching is only
  that the day *starts* at readiness (+0.93) and diverges as energy is spent, which is the intended
  behaviour rather than a drift.
