# 2026-09-24 — DV-12 and OR-162 head a lane they cannot be started from

**Branch:** `docs/dv12-gate-device` · **Lane B** (LB-145) · docs-only

`#1587` shipped half the `tab-switch-speed` batch and left `DV-12` + `OR-162` open, because the
measurement they turn on needs the S25 and the Device Verification session is archived. Both then
rose to the top of Lane B's READY list — **work nobody can start, heading the list of what to start
next.**

This is exactly the defect `LB-142` fixed on `RV-166` a few hours earlier, and I walked into it from
the other side. `RV-166` was blocked by a question and said so in prose inside its `Lane:` line;
these two are blocked by hardware and said so in prose in their body. `next-item.js` reads fields,
not paragraphs, so in both cases the runner offered blocked work as ready.

**Fix: `Gate: device` on both.** It is the field CLAUDE.md defines for this — it parks the entry
until someone picks the phone up, and lists it under `--sittings`, which is where a device question
belongs. Neither entry's lane changed: the *fix* is still Lane B's, and `Gate:` records that the
next action is not.

**The field must lead its own bullet.** `- **Lane: B** · **Gate: device** · …` parses as nothing —
`backlog-entries.js:80` anchors `Gate:` immediately after the dash, so a mid-line mention is
invisible. The first attempt here did exactly that and the entries stayed READY. Confirmed after:
PARKED 29 → 31, Lane B READY 20 → 18, and both appear under `--sittings`.

## Also: OR-162's cheapest option is not the cheap one

Its direction (a) is chart.js `resizeDelay`, *"currently set nowhere in the repo"* — which reads as
adding a prop. Measured here: **20 files call `ChartJS.register` individually and there is no shared
chart module.** `ChartJS.defaults.resizeDelay` would cover them all from one place, but that place
does not exist and would have to be imported before the first chart is constructed. So (a) is
"create a shared defaults module and route 20 files through it", and the entry now says so — it
changes which of the three directions is actually cheapest.

## Not done

No code. No chart change, no device measurement; `DV-12`'s pass test is unchanged and still owed.
