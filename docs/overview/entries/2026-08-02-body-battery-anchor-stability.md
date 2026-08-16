# 2026-08-02 — the Body Battery anchor flipped source mid-morning (Q-39)

**Branch:** `fix/body-battery-anchor-stability` · **Version:** 1.250.2 · Run-list item 3 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md). Plan: Workstream C of
the [owner bug batch](../../superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md).

## What was wrong

The anchor — the level the whole day's battery curve is walked forward from — was re-picked from
scratch on every read. Its first choice is our own composite readiness for today, which only exists
once `/api/readiness-score` has run. Before that, the fallback is last night's sleep score.

So the day started anchored on sleep, and the moment readiness first ran the anchor jumped to it and
the **entire day's arc shifted by the difference**. Reproduced on the seeded local user: 82 (sleep)
→ 54 (readiness), a 28-point move of every point on the curve, with nothing on screen explaining it.
Worse, it was not one-way — any later read that could not see the derived row re-anchored back to
sleep, so the number could oscillate.

## What shipped

The decision moved into a pure module, `app/api/body-battery/anchor.ts`, with one added rule: **once
today's anchor is readiness-derived it is frozen**. The route reads today's persisted snapshot
(`getBodyBatteryHistory` for a single day — no new repo method) and passes it in. A sleep-derived
anchor stays provisional and may upgrade to readiness exactly once, never back.

The response carries `anchorProvisional`, and the card says so — "provisional until readiness lands"
on the detail line, and a fuller sentence in the no-HR-data branch. The number legitimately moves
once; saying so beforehand is the difference between an explained change and an unexplained one.

## Decisions worth not re-litigating

**A frozen anchor stays frozen even if readiness is later recomputed to a different value.** A
logged morning check-in changes readiness, and honouring that would re-introduce the same mid-day
shift through a smaller door. The day settles on the number it settled on. There is a test for
exactly this.

**A persisted *provisional* anchor is not frozen** — it is the fallback the day opened on, and
re-deriving it each read is what makes the single upgrade reachable at all.

**Deliberately not done** (both are follow-ups the plan already records): unifying the two scores so
Body Battery never anchors on readiness — readiness is a composite that already folds in sleep, HRV
and RHR, so the two Home numbers being close is a modelling question, not a bug; and extracting the
~800-line readiness composite so Body Battery could compute it inline instead of falling back
(backlog **Q-42**).

## Verified on the dev server

Sequenced against the local DB with a sleep session ending today:

- read 1, pre-readiness → anchor 82, source `sleep`, `provisional: true`
- `/api/readiness-score` runs → read 2 → anchor 54, source `readiness`, `provisional: false` (the
  one permitted upgrade)
- derived row deleted, read 3 → **still** 54 / `readiness` / not provisional. Under the old code
  this is where it jumped back to 82.

Also with no history at all: 50 / `default` / provisional, stable.

The card was rendered headless at 360px in both light and dark with a genuinely provisional state
(history cleared so readiness could not produce a score): "Currently 50 — provisional, and
re-anchors once today's readiness is ready." No bad wrapping at that width. The cleared tables were
dumped first and restored after.

Ten unit tests cover the precedence matrix, the freeze, the single upgrade, clamping and the legacy
Cloud arms. Full suite green, lint and typecheck clean, custom rules pass.

## Not exercised

Pure TypeScript — reaches the device through a Railway deploy, no APK rebuild. Not run on the S25,
but nothing here touches native, safe-area, offline storage or gestures, and both themes were
checked at the S25's narrow width. No device-verification gate applies.
