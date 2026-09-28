# LB-175 — three of the four rows in my own entry were wrong

**Branch:** `fix/home-body-battery-failure-line` · **Lane B** · `app/session-select/**`.

LB-175 was filed a day earlier from a **text diff** of what disappeared when every read failed on a
cold start. Re-measured by reading what the screens actually *say*, three of its four rows do not
survive.

| row as filed | measured |
|---|---|
| Home · body battery absent | **correct** — the one section that vanishes in silence |
| Home · greeting and avatar absent | **wrong** — they fall back to `TrainingAI` and `?`, both neutral |
| Health · `ESTIMATED 1RM` absent | **wrong** — replaced by *"Couldn't load your strength progress"* |
| Health · `AVG DURATION` absent | **wrong** — replaced by *"Couldn't load your weekly stats"* + Try again |

A diff names what left the screen. It cannot say whether what replaced it is wrong, and here the
replacements were the honest failure lines the entry was asking for. `strength-progress-card.tsx`
already had `onError`, and `weekly-stats-hub.tsx` already checked `error` **before** `loading` with
a comment explaining why the other order is the defect.

## What shipped

Home's body-battery read carried `.catch(() => {})`, which cannot fire — `cachedFetch` resolves a
boolean rather than rejecting (RV-84) — and `{bodyBattery && <BodyBatteryCard …>}` removed the card
with nothing in its place. It now takes an `onError` and renders one line in the card's slot, only
when there is no cached arc to show: a stale arc beats a banner, which is the posture every other
read on this screen already takes.

## What the re-measurement found instead

Health prints **seven** explicit failure lines and is largely honest. What is not honest is the
empty-state copy underneath them — `BURNED`, `BMI`, `BALANCE`, `RESTING HR`, `HRV` and `SPO₂` all
read **"No data"**, and the energy-budget card says *"Add your height, age and sex in Profile"*,
which tells the owner to redo something he did months ago because one read did not land. That is one
shape across a dozen cells and a decision about what an empty metric cell should say, rather than the
per-card `onError` this entry was about, so it is filed as **LB-176**. `GOALS` is the only Health
section still vanishing silently and goes with it.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors · full unit suite green · build clean.

`e2e/rv150-failed-read-says-so.spec.ts` gains the case and a healthy-cold-start twin.
**Control-run:** against `origin/main` only the new failure case goes red; the healthy one passes in
both runs, so the line cannot be reached except by an actual failure.

**Not exercised:** the device. Render-only, no native or offline-first surface, so the 412 px harness
covers the path it has.
