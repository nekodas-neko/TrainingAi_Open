# 2026-08-24 — BF-4's experiment run against the real model, and the leg nothing measured

**Branch:** `perf/scan-payload-instrumentation` · **Lane A** · migrations 208 + 209, the scan route,
the AI instrumentation. No client change, no APK.

## The experiment the entry asked for

BF-4 says: *"run the same photo three ways and compare… If (b) moves the number, #112 is the
regression and the schema is the lever."* A `GOOGLE_GENERATIVE_AI_API_KEY` is present in the session
sandbox, so it was run rather than reasoned about — same image, same system prompt, one variable at a
time, n=3–5 per arm.

| arm | median | output tokens |
|---|---:|---:|
| (a) today's `generateObject` + `ScanSchema` | **1,700 ms** | ~485 |
| (b) same, plus `maxOutputTokens: 700` | 1,672–3,530 ms, no trend | ~500 |
| (c) same, schema **flattened** (no nested `ingredients` array) | **1,029 ms** | ~146 |
| (d) `generateText` + `JSON.parse` — the pre-#112 shape | **1,529 ms** | ~450 |

**`maxOutputTokens` is ruled out.** Output tokens were ~500 with and without it, because the model was
never hitting a cap. (b) came out *slower* than (a) on the mean — noise, but certainly not a win.

**#112 is essentially exonerated.** `generateObject` costs about **10%** over the `generateText` +
`JSON.parse` it replaced, on overlapping ranges (n=5 each). The entry's central hypothesis needs a 2×,
and it is not there. That is a relief as well as a result: CLAUDE.md forbids `JSON.parse` of model
text, so had this gone the other way there would have been a rule to argue with.

**Latency tracks OUTPUT tokens almost exactly**, and the nested `ingredients` array is ~70% of them —
~485 tokens → ~1.7 s, ~146 → ~1.0 s. **(c) is not a proposal**: `sumIngredients` and `perServing` need
that array. It exists to say where the time goes, and it says the schema *is* the lever — just not via
the knob the entry named.

**Input tokens stayed at 1,093–1,275 regardless of image bytes**, which independently confirms the
entry's argument that bytes above Gemini's tile budget buy no accuracy.

## The gap the entry marks 🔴

*"Nothing times the client half… the next report of the same shape starts from zero again."*

Half of that is fixable from the engine, and this is it: **`ai_call_log.payload_bytes`** (migration
208), recorded beside the model's own `latency_ms`. A wall-clock complaint minus a known model time
and a known payload size names its own culprit instead of restarting the argument.

Three decisions worth not re-deriving:

- **Nullable, not 0.** Only the image shape of `/api/nutrition/scan` has a payload; the url and text
  shapes legitimately have none, and a 0 there would read as "measured, and it was empty".
- **Decoded bytes, not base64.** The wire cost is ~4/3 of what is stored, but the decoded size is the
  honest number — it is what the upload represents, and the inflation is a constant anyone can apply.
- **On `ai_call_log`, not a new table.** The scan's payload *is* that AI call's input, and the two
  numbers are only useful side by side. A separate timings table would have been new infrastructure
  for one column (module-map §0).

Migration **209** regenerates the `claude_ro` views, because the schema is default-deny and names its
columns explicitly — without it the new column is invisible to `/api/admin/db-query` and a DB-backed
test fails on the divergence.

## Verified

- Through the **real route** on `pnpm dev`, not just by test: a 17,591-byte photo logged
  `payload_bytes 17591`, `latency_ms 1863`, `input_tokens 1275` — **exactly the production band**
  (1,275–1,298) — and a sibling `weekly-digest` row kept its NULL.
- `claude-ro` suite 33/33 (it fails if the views and the tables diverge, which is what caught a
  botched first attempt at 209 — a header edit that sliced 1,400 lines of views off the file).
- Full suite **563 files / 4,620 tests**; `pnpm check:rules` 54 of 54.

## What is left on BF-4

- **The client leg still has no number.** `payload_bytes` prices the upload's *size*, not its
  *duration*, and "photo → result" starts on the device. Lane B's half — and it can now send its
  elapsed time to a column that exists.
- **Railway cold start on this low-traffic route** is the one candidate never tested and, after the
  above, the leading one. A sandbox session cannot test it.
- **Trimming the ingredients array** is the only measured latency lever left (~700 ms), and whether
  fewer ingredients or fewer per-ingredient fields is acceptable is a product question.

**Failure surfaces NOT exercised:** production — no deploy has run migration 208, and the experiment
ran against the sandbox's own network to Google, so the absolute milliseconds are not the owner's
(production image scans average 4,168 ms against ~1,700 here). **The comparisons hold; the magnitudes
do not transfer.** Nothing device, native, safe-area or offline is touched.
