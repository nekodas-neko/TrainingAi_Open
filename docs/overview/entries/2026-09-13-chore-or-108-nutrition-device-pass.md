# 2026-09-13 — the Nutrition tab's device pass: 14 cleared, 3 failed, 2 bugs nobody had filed

**Branch:** `chore/or-108-nutrition-pass` · backlog only. No product code.

## What the pass bought

Nineteen device checks sat on one tab. The owner worked through them in a sitting and the queue's
`Verify: device` debt went **58 → 44**.

**Cleared (14):** BF-101, BF-103, BF-104, BF-109, BF-26, BF-46, BF-52, **BF-57**, BF-72, BF-73,
BF-75, BF-76, Q-187, Q-406.

**BF-57 is the one worth naming** — the two-phone, two-account test, the only item on the whole
134-item list that could not be done alone. A friend scanned a `Share code` label from their own
account and the meal saved.

## Three failures

- **BF-74** — *"it gives me an undo option; but no warning before removal"*. The ✕ is reachable, so
  the corner fix worked; it destroys the photo on one tap and offers a toast afterwards. **The entry
  checked WHERE the control sits and never asked what hitting it costs** — which, on a photo just
  taken, is the whole risk.
- **BF-98** — the inverse of the original defect: a collapsed section holding a *grouped meal* shows
  no macro overview, while one holding loose items does. **Filed with both readings and neither
  chosen**, because they point at different components and `meal-card.tsx:90` suggests one of them
  should already work.
- **BF-99** — *not a failure of the app.* The checklist sent the owner to the Nutrition gear icon,
  which holds only meal-type names. **My error**, recorded in the entry so the re-ask names the real
  route first.

## Two bugs that were not in the queue at all

- **OR-108 (new)** — *"scanning barcodes still doesn't auto save an image for the food; or does
  taking a photo of the food save the image either."* Reported against LA-36 and **is not LA-36**:
  that entry says the column is written and read by nothing; this is the other end — two capture
  paths that both have an image in hand and discard it.
- **BF-134** — the owner specified the calorie model they want, for the **second** time verbally:
  open at base ± goal and *earn* exercise calories rather than forecasting them (~1300–1400 at rest,
  ~1600 after a session). **A requirement given twice with no entry is the finding.** It also
  contradicts LB-50/BF-102's measured activity factor, which is noted so the app does not ship two
  models.

## One check retired on the owner's instruction

**RV-35** needed the app left open across midnight. Owner: *"lets just make the best guess and file
it as a non issue till its reproduced."* Its `Verify: device` is removed — but the entry now says
what that buys: a fix landing without a device check **needs a test that fails before and passes
after**, because nothing else will catch a regression there.

## The pattern worth carrying into the next section

Three entries came back *"I don't know where this is"* and were nonetheless marked pass. **A check
whose location the owner cannot find collects false passes.** Locations were added to all 19 Nutrition
items mid-pass; the same is owed for every section before it is handed over, not after.

**Surfaces not exercised:** none apply — backlog only. `pnpm check:rules` **Ran 74 of 74**.
