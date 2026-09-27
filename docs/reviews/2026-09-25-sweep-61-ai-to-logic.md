# Review sweep 61: where AI can be replaced with logic

**Date:** 2026-09-25 · **Agent:** Review · **Base:** `main` 1ccde355 · **Docs only.**
**Owner request:** *"we use AI more than we need to and could use logic instead to save on tokens and offline compatibility."*
**Method:**
- Two read-only agents covered the training surfaces and the nutrition/health surfaces.
- I re-checked each load-bearing citation at source.
- Usage comes from `claude_ro.ai_call_log`, which holds the owner's rows only.

**Prior work:** sweep 51 (2026-09-20) filed RV-65 (the prescription; gated on the owner, still queued) and
RV-66 (goal numbers from the baseline; shipped in #1468).

## Usage, 2026-08-26 to 2026-09-25 (the owner's calls)

| Surface | Calls | Tokens | Avg ms | Trigger | Verdict | Entry |
|---|---|---|---|---|---|---|
| prescription | 35 | 127,560 | 2,124 | automatic (workout open) | LOGIC-FIRST | RV-65, **RV-202** |
| nutrition-scan | 29 | 40,302 | 2,201 | tap | KEEP photo/recipe; LOGIC-FIRST for describe, barcode and refine | **RV-203** |
| coach | 5 | 32,777 | 1,575 | chat | KEEP | — |
| health-insight | 26 | 9,581 | 961 | automatic (screen open) | LOGIC-FIRST | **RV-201** |
| weekly-digest | 7 | 6,563 | 1,472 | automatic (Home banner) | LOGIC-FIRST | **RV-201** |
| generate-program | 1 | 6,213 | 4,786 | wizard | KEEP (see below) | — |
| nutrition-goals-recommend | 2 | 3,415 | 1,893 | tap | REPLACE | **RV-200** |
| meal-plan-generate | 2 | 2,861 | 3,186 | tap | KEEP new meals; library first | **RV-203** |
| session-explain | 6 | 2,259 | 918 | automatic (page open) | REPLACE | **RV-200** |
| daily-digest | 3 | 1,579 | 1,004 | automatic (End-of-Day) | REPLACE | **RV-200** |
| exercises-generate | 3 | 1,296 | 1,181 | tap | KEEP, optional | — |
| running-plan-explain | 2 | 612 | 850 | automatic (card) | REPLACE (delete) | **RV-200** |
| workout-review, recap | 0 | — | — | sheet open / tap | REPLACE / LOGIC-FIRST | **RV-204** |
| builder-chat, exercise images | 0 | — | — | chat / admin | KEEP | — |

**Total: 121 calls and about 235,000 tokens in 30 days, with zero failures.** On a flash-lite model that
is cents a month, so tokens are not the reason to do this. The reasons are that the app works
offline and responds faster, and that the text is correct by construction. That last point is not
hypothetical: Q-292 found a false superlative or an imperial unit in 16% of 117 health insights.

## The pattern

Almost every prose route already computes its facts in code, then asks a model to reword them.
The model adds tone and a failure mode:
- **Offline:** the card errors or shows a cached reading from another day.
- **On failure:** some routes throw away the computed numbers. The goals route returns 500; the
  weekly digest returns 429 without its metrics.
- **Every visit:** five of these fire on screen open, so every visit pays the latency.

**What stays on the model is the work only a model can do:** reading a photo or a recipe page,
understanding free text (Coach, the builder chat, naming a new exercise), and inventing meals
the user has never saved.

## Kept, and why

- **Coach and builder-chat** are open conversation. Coach's scripted swap flow could become a button
  offline; existing widget-option entries cover it.
- **generate-program:** a deterministic generator needs split templates, which pushes against the
  no-hardcoded-session-names rule. At one call a month it is not worth it. Not filed.
- **exercises/generate** already runs after a library fuzzy match, and manual entry works without
  it.

## Not exercised

- Everything here is read from code and `ai_call_log`. Nothing ran on the device.
- The text similarity of successive health insights was not measured.
- RV-65's open measurement (the model's pct against the zone midpoint) is still open.
