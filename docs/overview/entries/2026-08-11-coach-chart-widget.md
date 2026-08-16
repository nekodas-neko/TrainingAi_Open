# 2026-08-11 — Coach can draw a chart, and stops promising one it couldn't (Q-141)

**Branch:** `feat/coach-chart-widget` · **v1.281.0**

## Q-141 pointed at a route nothing uses any more

The entry describes the owner asking the AI chat for a chart twice and getting text both times, on
`/api/ai-chat` + `components/chat.tsx`. Re-checking against `main` before implementing: **no UI links
to that surface.** `overview-screen`, `coach-fab` and `done-screen` all go to `/coach`, and
`/sheet/[id]/chat` only redirects to the orphaned `/chat`. Implementing the filed fix would have
improved a page no one can reach.

## What was actually live, and it was worse

Coach's system prompt carried a `## Charts` section — *"2-6 items → a chart followed by a choice list
whose options carry a colorKey, so the rows double as the chart's legend"* — and **Coach had no chart
mechanism of any kind**: no tool, no schema, no renderer. `coach-message.tsx` puts assistant text
through markdown and nothing else.

Reproduced against the live model, "Show my body weight progression over time on a chart":

- fetched the data correctly, then
- emitted **no chart**, and
- emitted a `renderChoiceList` of colour-keyed rows — `Jul 21 – Jul 25 / 81.85 kg – 82.05 kg`, cyan;
  `Jul 26 – Jul 30`, green; `Jul 31 – Aug 3`, purple.

That is the pairing rule firing with the chart half missing: **a legend for a chart that does not
exist**, rendered as tappable rows that answer a question nobody asked. The prompt was instructing an
output the app could not produce.

## The fix

A `renderChart` widget, following the existing client-side-tool pattern:

- `ChartSchema` in `widgets.ts` — `line` / `bar` / `pie`, 2–40 labels, up to 4 datasets, an optional
  `colorKey` per series. Narrower than `parse-chart-blocks.ts`'s `ChartPayload`, which it feeds:
  that schema's colour fields are `string | string[]`, and Gemini's function declarations are fussy
  about unions (this feature already lost a day to a `z.literal(false)`).
- `CoachChart` renders through the existing `ChartMessage`, `dynamic({ ssr: false })`.
- The prompt's Charts section now says *how* to draw one and, specifically, not to follow a chart
  with a picker of the same items.

**The one real design point: a chart is not a question, so nothing will ever answer it** — and an
unanswered client-side tool call wedges the whole thread (the `AI_MissingToolResultsError` bug fixed
the day before). So it resolves itself on mount with `{ status: 'shown' }`, and the turn continues.
Two consequences that had to be handled explicitly:

- A resolved widget normally collapses into a spent-form bubble. A chart is the answer, not the form,
  so `coach-message.tsx` special-cases it and it never collapses.
- If the app closes before the chart mounts, the call is still open — the dangling resolver closes it
  like any other, which a test now pins.

**Theme-token trap avoided:** `ChartMessage` passes dataset colours straight to chart.js, and canvas
`fillStyle` cannot read a CSS custom property — a `var(--accent-cyan)` would have painted black.
`CoachChart` calls `resolveColor` first. This is the bug CLAUDE.md records as having shipped twice.

## Verified against the live model

Same prompt as the reproduction, after the change:

```
{"kind":"chart","chartType":"line","title":"Body Weight Progression",
 "labels":["Jul 21","Jul 24","Jul 27","Jul 30","Aug 3"],
 "datasets":[{"label":"Body Weight (kg)","data":[81.85,82,82.15,82.3,82.5],"colorKey":"cyan"}]}
```

One chart call, real numbers from the tool result, no legend-list, and no prose restating the values.
The follow-up turn was then exercised end to end — sending the thread back with
`output: {status:"shown"}` attached and asking *"is that trending up?"* — which answered normally with
**no `MissingToolResultsError`**. That is the loop that would wedge if the self-resolve were wrong.

Full suite 440 files / 3534 tests green, lint and all custom-rules scripts pass.

**Not exercised: device.** The chart renders in Samsung's WebView, which is where this app's canvas
and gradient rendering has misbehaved before — treat the visual as unverified until it is seen on the
S25. Nothing here touches an offline-first domain, a native plugin, safe-area or notifications, so it
reaches the APK through the Railway deploy with no rebuild.

## Left undone

The dead `/chat` + `/api/ai-chat` pair is still in the tree, unreachable rather than broken. Deleting
it belongs with the cleanup `app/api/coach/route.ts` already describes ("both exist until Phase 2
repoints the four live entry points, at which point the old pair is deleted") — the repoint happened,
the deletion did not.
