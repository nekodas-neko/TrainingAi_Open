# 2026-08-10 — Coach stopped transcribing the database: 2,204 output tokens → 41

**Branch:** `feat/coach-sourced-pickers` · **v1.279.0**

Owner: *"try make the ai model be used as minimally as possible and have direct links to saved data."*

That is the right instinct and the token log had already proved it. A nine-option picker cost **554
output tokens** — every id, name and subtitle typed out by a language model, describing rows the app
holds and can read in a millisecond.

## The change

`renderChoiceList` takes a **source** instead of options:

```json
{"kind":"choice_list","prompt":"Which exercise would you like to change?","source":"exercises"}
```

Three sources — `sessions`, `exercises`, `swap_candidates` — and the widget fetches the real rows
from `GET /api/coach/options`. The model writes a source name and stops.

Flat fields rather than a discriminated union, deliberately: Gemini's function-declaration schema is
fussy about unions and this feature has already lost a day to one (`z.literal(false)`).

## Measured, cumulative with yesterday's thinking fix

| | output tokens | model latency | wall clock |
|---|---:|---|---|
| before either change | 2,204 | 10.0 s | ~8.6 s |
| thinking level only (v1.277.1) | 554 | 3.5 s | 2.2–3.4 s |
| **+ sourced pickers** | **37–52** | **0.68–0.96 s** | **1.0–2.8 s** |

**A 54× reduction in output tokens, and roughly 7× faster end to end.**

The swap flow now runs **three turns with no read tools at all** — `getProgramStructure` and
`findSwapCandidates` are simply not called, because the sources do that work:

```
turn 1  renderChoiceList source=exercises
turn 2  renderChoiceList source=swap_candidates sourceId=<picked>
turn 3  proposeChange
```

## Two things this buys beyond speed

**An invented id becomes structurally impossible** for these lists rather than merely forbidden. The
model never writes one. That bug class shipped twice in this feature — `push-123` in phase 1, and
the dead-end that needed `findSwapCandidates` — and it cannot recur here.

**The options are current when the widget renders**, not when the model spoke. A proposal sitting in
a thread across a program edit now paints the edited program.

Both tools stay: `findSwapCandidates` still takes a `query` for "something with dumbbells", and
`getProgramStructure` is still how the model gets an id for a `proposeChange` target.

## A wedged conversation, reported from the device mid-session

The owner had a replacement picker on screen and typed *"Update with Jefferson curls"* instead of
tapping a row. Every turn after that returned *"Something went wrong. Ask again and I'll pick up
where we left off."* — **and asking again could not help**, because the unanswered call stayed in the
thread forever. The conversation was permanently dead.

Reproduced on the first attempt. The server log named it exactly:

```
AI_MissingToolResultsError: Tool result is missing for tool call G9edgyF5
```

A widget's result only arrives when the user taps something. The provider refuses a thread
containing a tool call with no result. So typing instead of tapping — the most natural way in the
world to change your mind — put the thread into a state it could never leave.

`resolveDanglingWidgetCalls` closes any widget that a **later user message has overtaken**, marking
it `cancelled` (already a member of `WidgetResultSchema`, and an accurate description of what
happened). The newest widget is left alone: nothing has overtaken it, so it is still awaiting a tap.

Verified against the owner's exact sequence — pick, pick, type — which now recovers and asks a
sensible follow-up instead of dying. Five tests.

## Also: the backtick check

A backtick inside the backtick-delimited system prompt has broken `next build` **three times** in
this feature, always from the same instinct — writing `` `source` `` because that is how field names
are written everywhere else. `scripts/check-prompt-backticks.js` is the two-second version.

**Its first implementation did not work**, and the way it failed is worth recording: the regex
matched non-greedily to "the next backtick", which is *exactly the character the defect adds* — so
it stopped at the defect and inspected a body that looked clean. It passed on a planted bug. It now
scans to the literal's real terminator, and was verified in both directions.

## Verification

| Check | Result |
|---|---|
| Full suite | 431 files, **3442 tests** green |
| `pnpm build` | compiles |
| Lint + all 16 custom-rules scripts | pass |
| Three-turn swap | sourced both pickers, correct `proposeChange`, zero read tools |
| Create-an-exercise (Jefferson curl) | correct patch, `Hamstrings, Lower back` + `Barbell` |
| Six-tool progression analysis | real numbers, 4.3 s |
| Ownership | 4 new DB-backed tests — a stranger's session id returns **nothing**, not their exercises |

**Not exercised: device.** All of it was driven through the API and the model against the local DB.
The widget now has a brief loading state it did not have before, which has not been seen on the S25.
