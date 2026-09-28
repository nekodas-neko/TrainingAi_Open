# 2026-09-28 — redrawing the Home banner mockup that was approved and then lost

**Branch:** `docs/home-banner-stack-mockup` · Orchestrator

`RV-119` carried an owner approval from 2026-09-22 and nothing an implementer could build to: the
mockup was shown in a session and never saved. Asked yesterday whether to redraw or build to the
written split, he chose redraw.

[`docs/design/2026-09-28-home-banner-stack.html`](../../design/2026-09-28-home-banner-stack.html) ·
[hosted](https://claude.ai/artifact/V3PRnnjchdhAA9nXYwgXLt)

## The split was not re-asked, and was verified rather than trusted

The entry says two banners stay full-width and four collapse. **Checked against `main`**:
`app/session-select/session-select-content.tsx:1128–1192` renders `IllnessAdvisoryBanner`, the
auto-detected walk/run prompt, the `earlyDeloadRecommended` banner, `showGoalsCheckin`, the
day-review `DismissibleBanner` and `WeeklyRecapBanner` — six, not seven, because the APK banner
already shipped as removed. The split stands as agreed.

## What the page actually asks

One question: what a collapsed strip looks like. Two treatments drawn.

- **A — one strip.** The four notifications become a single row showing what is waiting and how
  many, expanding inline on tap. Recommended: it is the only version that reliably puts a real card
  in the first screen, and the four are the same kind of thing, so grouping them is honest rather
  than a height trick.
- **B — thin rows.** Each keeps its own line at about half today's height, one tap to act or
  dismiss.

**The trade is stated rather than hidden:** B costs height, A costs a tap, and which is worse
depends on whether he treats these as a to-do list or as noise. An item behind a tap is an item he
may not action.

## A limit worth stating

Heights are drawn to scale against each other, **not measured on the device**. A real screenshot
needs all six banner conditions true simultaneously, which no sandbox can arrange. Whichever
treatment he picks owes a device look at the real stack before it is called done — recorded on the
entry, not just here.

## `LB-135` is struck as superseded

Its job was exporting the lost artefact. The artefact is unrecoverable, so redrawing replaced
exporting. The rule it leaves behind is the durable part: **a mockup is not shown until it is in
`docs/design/`** — an approval whose picture lives only in a transcript records that a decision
happened and loses what was decided, which is what kept `RV-119` unbuildable for six days.

**Not exercised:** a static page. No component changed, nothing rendered on a device.
