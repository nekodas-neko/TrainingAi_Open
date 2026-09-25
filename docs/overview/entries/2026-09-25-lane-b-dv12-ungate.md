# 2026-09-25 — DV-12 un-gated, and the measurement I got wrong the same day

Lane B, docs-only. `DV-12` — the owner's stated highest priority — leaves `PARKED` and heads the lane.
No code: the investigation says the obvious fix cannot yet be told apart from doing nothing.

## The gate had outlived its question

`Gate: device` was added by LB-145 because *"the remaining question needs the phone"*, and the entry's
very next line said the opposite: *"What is still unknown is answerable from SOURCE, not from the
phone."* Both halves are settled now, so the gate was parking his top priority for a question nobody
still had. What remains needs the phone only to **verify**, which is a prose
`Device check owed on merge:` — not a `Verify:`, which would file unbuilt work as shipped.

## The mechanism, from source

**20 chart components set `responsive: true`. None sets `resizeDelay`.** `tab-shell.tsx:209` puts
`[content-visibility:hidden]` on the outgoing panel and takes it off the incoming one, so both panels'
canvases change size on every tap and each `responsive` chart takes a ResizeObserver callback →
`update → _tickSize → _computeLabelSizes → set font`. That is the chain the device profile named, and
it explains why it fires on *every* tap rather than only on Health.

## I got a measurement wrong and shipped it

Earlier the same day I added to this entry: *"216, 228, 465, 91, 235 ms with `canvasTotal: 0`, so a
large cost exists independently of chart.js."* **Health does render canvases — five — but not until
~18 s in** (0 at 3 s, 0 at 8 s, 5 at 18 s: dynamic imports plus the fetches behind them). My probe
waited 1.5 s per switch, so it timed a *loading* page and I read it as a chart-free one. The seeded
user had data all along: 16 `body_metrics`, 22 `sleep_sessions`, 9 `workout_sessions`.

Corrected in place on the entry rather than deleted, because the wrong figure had already merged. The
lesson is the one I keep writing about other people's entries: **a measurement is only as good as the
precondition you did not check.** Waiting for the thing you are measuring to exist is that precondition.

## The A/B, once the charts were really there

| switch | baseline | `resizeDelay: 200` on all 20 |
|---|---|---|
| → More | 233, 255 ms | 283, 187 ms |
| → Health | 480, 319, 0 ms | 420, 407, 93 ms |
| → Home | 87 ms | 73 ms |

**No effect that survives the noise** — the spread inside each column is larger than any difference
between them. Applied by script to all twenty sites and reverted.

## And the obvious way round the dev-mode confound is closed here

`next dev` is unminified, in React dev mode, and compiles on demand, so its tab switches are dominated
by work the APK never does — which is consistent both with `resizeDelay` being ineffective and with it
being effective but invisible. The clean answer is a production profile, and **`pnpm start` cannot boot
in this sandbox**: the instrumentation hook fails with *"MODEL CONSTANTS UNAVAILABLE — could not list
the bucket: SignatureDoesNotMatch (403)"* and every request 500s.

So the remaining discriminators are to instrument chart.js's resize path and count callbacks per tap —
which answers the mechanism without needing the timing to move, and works in dev — or the phone.

## Why no fix shipped

There is no shared chart module: all twenty components call `ChartJS.register(...)` at their own module
scope and build their own inline options, so `resizeDelay` is a twenty-file sweep whichever way it is
done. **Shipping that on this evidence would repeat BF-61 exactly** — a change that looks right, with no
measurement able to distinguish it from nothing — and BF-61 came back from the device twice for precisely
that reason. The entry is startable; its first task is a measurement, not the fix.
