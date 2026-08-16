# 2026-08-09 — The swap flow dead-ended because a tool was missing, not because the model misbehaved

**Branch:** `fix/mood-checkin-no-refetch-after-save` · **Q-158 + two owner reports** · **v1.275.0**

## What the owner hit

On the S25, first real use of AI Coach:

1. *"Can change an excercise for me"* → picked **Lower** from the session list → **nothing happened**.
   Coach replied in prose asking which session — a question they had just answered — with no widget
   under it.
2. A good progression summary ended with
   `[default_api:getPlateauReport, default_api:getWorkoutsByExercise]`.
3. *"this also took quite a while to load"*.

## 1 — The dead end was a missing tool

Reproduced locally on the first try. Turn 2 came back as text: *"What exercise would you like to
replace Barbell Bench Press with?"* — and no widget.

**The model was not ignoring instructions. It had no way to obey them.** Nothing exposed the
exercise catalogue, so a list of replacements was not something it *could* draw; prose was the only
option left. Same shape as the Phase 1 invented-ids bug, and the same fix: give it the data.

`findSwapCandidates` takes a session-exercise id and returns catalogue exercises training the same
main muscles, minus anything loading an injured area. Matching is `injurySafeAlternatives`, not a
second copy of "same main muscle" — one formula, one place — which makes every suggestion
injury-aware for free.

The system prompt now also states the rule the dead end violated: **never end a turn asking a
question in prose when a widget could ask it**, and never re-ask something a resolved widget already
answered.

Measured after: pick exercise → `findSwapCandidates` → replacement list → `proposeChange`
(`Barbell Bench Press → Dumbbell Bench Press`). Three turns, no prose question.

## 2 — The tool-name bracket

Gemini appends a citation-like bracket naming the functions it called. The prompt now forbids it,
**and** `stripToolCitations` removes it at render — because "instruct the model not to" already
failed once in this feature. Narrow by design: it matches only the `default_api:` form, so ordinary
brackets and markdown links survive. Five tests.

## 3 — Latency: measured, not fixed

| | first tool | total |
|---|---|---|
| "change an exercise" ×3 | 1.9–2.5 s | **7.2 / 8.8 / 10.6 s** |
| "how has my push progression been" | 2.5 s | 10.6 s (first text at 10.1 s) |
| "what is my calorie goal" | 1.4 s | 3.6 s |

Two sequential model round trips: one to read the program, one to generate the widget. **Grounding
is not the cost** — disabling `google_search` gave 7.6 s and 8.8 s, no better, so it stays.

Two runs out of eight were wild outliers (**49 s and 121 s**) with no code difference — Gemini
variance. The screen says "Thinking…" throughout, so it is honest, not hung. **Nothing here is
fixed**; a real improvement needs a decision from the owner, filed as **Q-170**.

## Also: Q-158

A readiness check-in saved with nothing sore left the "most of this session's muscles are still
sore" banner on screen, computed from **yesterday's** log. `onSaved` only stored the log in local
state; nothing re-fetched. The invalidation was already correct.

The sheet fired `onSaved` *before* invalidating — fine for a callback that sets state, wrong for one
that refetches — so it is awaited first now, or the refetch reads the stale cache straight back.

Proven both ways in a real browser at 412×891: pre-fix a save fires **only** `POST /api/mood`;
post-fix it also fires `workout-data?tab=meta`, `next-session`, `workout-data?tab=all` and
`readiness-score`.

The readiness prompt card was extracted rather than appended to `session-select-content.tsx`, a
size-checked hotspot — baseline 1484 → 1458.

## Verification

425 files / **3387 tests** green · `pnpm build` compiles · lint + all custom-rules scripts pass.

**Not exercised: device.** All three Coach findings came *from* the device and were reproduced and
fixed against the dev server; the fixes themselves have not been re-checked on the S25.
