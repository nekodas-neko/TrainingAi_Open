# The Body Battery card now explains a model the app does not implement — 2026-08-31

*Tuning · production data pulled 2026-08-31 (owner screenshot at 21:45 Brisbane). Files **TN-19**.
Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

Owner, second report on this pillar in six days: *"any work being done for this? still not very
usable."* Screenshot: **Body Battery Drained, 0**, *"Started at 55 from readiness · +0 charged ·
−113 drained"*, flat on the floor from roughly 14:00 to 21:42.

**Two answers. Nothing has shipped, and the card has since started making promises the model cannot
keep.**

---

## 1. Nothing in the chain has shipped

Verified against `main` on 2026-08-31: **TN-15, TN-18, TN-6a, TN-6 and TN-2 are all still queued**,
and no commit in the last 40 touches any of them. They sit at **queue positions 75–83 of 235**.

Priority in this repo is queue position, so the pillar the owner has now complained about twice is
**about a third of the way down the queue**. That is the honest answer to *"any work being done"* —
**no**, and not because anything is blocked: TN-6a, TN-18 and TN-15 are all fully specified with
owner sign-off. **Re-prioritising is the owner's call, and it is the only thing that changes this.**

---

## 2. The new explainer promises five mechanisms; four are inert or backwards

`components/body-battery-card.tsx` now renders a **HOW IT MOVES** panel:

| the card says | measured |
|---|---|
| **RECHARGES · Deep sleep** | **Structurally impossible.** `walkBodyBattery` filters to `tsMs >= wakeTime`, so overnight is never simulated. Sleep reaches the number only through the readiness *anchor*, which the card lists separately as *"opens each morning at your Readiness"*. |
| **RECHARGES · Calm rest** | **6 points across 8 days**, and **0 today**. Charging needs HR ≤ `restingHr + 0.05 × reserve`; per TN-2 that is a time-weighted **0.5%** of the waking day. |
| **DRAINS · Training** | **Q-521: a workout moves the end value by 0.6 points.** |
| **DRAINS · High heart rate** | **The only mechanism that works** — and per Q-521 it tracks *wear time*, not exertion (`corr(hr_sample_count, drained)` **+0.518** against `corr(steps, drained)` **−0.153**). |
| **DRAINS · Daytime stress** | The stress term, on a metric that **rises on good days** (Q-507: **+0.386** with readiness, **+0.477** with the sleep score). |

**Eight days of production:**

| date | anchor | charged | drained | end | HR samples |
|---|---|---|---|---|---|
| 08-31 | 55 | **0** | **113** | **0** | 3,643 |
| 08-30 | 66 | 1 | 52 | 15 | 134 |
| 08-29 | 49 | **0** | 47 | 2 | 3,378 |
| 08-28 | 57 | 3 | 70 | **0** | 2,754 |
| 08-27 | 51 | **0** | 13 | 38 | 39 |
| 08-26 | 53 | **0** | **0** | 53 | **0** |
| 08-25 | 45 | 1 | 76 | **0** | 2,934 |
| 08-24 | 57 | 1 | 79 | **0** | 2,754 |

**The entire recharge half produced 6 points in 8 days.** Five of eight days end at 0 or 2. And
**2026-08-26 is the cleanest possible demonstration of Q-521**: zero HR samples, therefore zero drain
and zero charge, ending exactly at its anchor. **No wear, no change** — the model is integrating
wear time.

### Why this makes the tile *less* trustworthy than before the card existed

The explainer is a genuine usability improvement in intent, and it has made the problem worse in
effect. Before it, an implausible number was just an implausible number. Now the app states five
testable claims beside it, and the owner can check them against a day where they trained, wore the
ring 3,643 samples' worth, and watched it read **+0 charged**. **A wrong number the app explains is
worse than a wrong number it does not**, because the explanation converts a vague doubt into a
demonstrated one.

**⛔ The fix is NOT to soften the card.** Rewording it to match a broken model documents the defect
instead of fixing it, and the owner would be entitled to read that as a cover-up. **The card is
correct about what the model *should* do — it is TN-15's specification, rendered.** Ship TN-15 and
the card becomes true.

---

## 3. What would actually change the screenshot, in order

1. **TN-6a** (suspend the temperature penalty) — the anchor is readiness, and readiness carries a
   **−16 pt/day** penalty firing on 89% of days. On its own this lifts the mean morning anchor
   **64.8 → 76.8**. Today's 55 would open nearer 67.
2. **TN-18** — one condition, and it stops the deload banner the owner sees.
3. **TN-2** (the charge window) — this is the `+0 charged` line directly. Until the boundary moves,
   the RECHARGES half of the card cannot fire regardless of behaviour.
4. **TN-15** — the drain/recharge redesign, which is what makes `Training` and `Deep sleep` real.

**Steps 1–3 are small and specified.** TN-15 is the large one, and it is the only one that needs
design work.

---

## Failure surfaces not exercised

No code ran — SQL against production, source reading, and the owner's screenshot. No `pnpm dev`, no
device, no APK. **The card's rendering was read from source, not observed** beyond the screenshot.
The 8-day table is stored model output, not a re-run of the walk. Counts are the owner's account only.
