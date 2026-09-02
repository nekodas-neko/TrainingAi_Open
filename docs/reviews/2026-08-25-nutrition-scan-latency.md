# 2026-08-25 — nutrition photo-scan latency: the whole investigation (BF-4)

**Extracted from `docs/implementation-backlog.md` on 2026-08-25**, per the compaction chore recorded
in [`docs/doc-size-baseline-history.md`](../doc-size-baseline-history.md). BF-4 stays in the queue as
a decision plus a pointer here; nothing below is lost, and nothing below is startable work.

**The state, in one line:** every hypothesis has been measured and retired, and the entry now waits
on **one photo scan by the owner** — after which `input_tokens`, `latency_ms` and `payload_bytes`
answer the remaining three questions at once.

---

### [nutrition][platform] 🟠 BF-4 — the photo scan feels much slower, and the only dated change is the structured-output conversion

- **Gate:** owner — set 2026-08-25; see the re-measurement below. One photo scan unblocks it.
- Lane: A — **the Lane B half SHIPPED 2026-08-23 (v1.331.0)**: `capture-step.tsx` bounds the photo to
  1024 px, a **-86.6%** payload cut
  ([`journal`](../overview/entries/2026-08-23-bounded-scan-photo-payload.md)). **It was NOT shown to be the
  owner's slowdown** — #112 and the cold-start check are the open half, and both are Lane A's, which
  is why this entry's lane is now A. Nothing here is startable by Lane B.


> ### ⚠️ RE-MEASURED 2026-08-25: nothing here is startable — it is waiting on ONE photo scan
>
> **The two hypotheses left "on the table" below were already measured** — migration `208`'s header
> records it, 2026-08-24, against the real model: `maxOutputTokens` changes nothing (never hitting a
> cap) and `generateObject` costs ~10%, not a regression.
>
> **But its conclusion — *"latency tracks OUTPUT tokens almost exactly"* — does not hold for the case
> this entry is about.** Over all **30** production scans: r(latency, `input_tokens`) = **+0.958**,
> r(latency, `output_tokens`) = **−0.122**. Both readings can be honest — a probe holding input fixed
> will see output matter, while in production output barely moves (197→482) and the image swings
> input 6× (206→1,298). **So the lever is the image payload, not the schema or an output cap.**
>
> **Which is what the Lane B half already did — and it has never once run.** The 1024 px bound
> shipped **2026-08-23**; the newest image-shaped scan is **2026-08-21**. Its **−86.6%** claim is
> unverified against a real call, and `input_tokens` sat at a near-constant **1,275–1,298** across
> all 17 image scans — that is the number that should drop.
>
> **`payload_bytes` has never captured a value, anywhere.** Not a wiring defect: the route passes
> `payloadBytes` on the image branch and migration 208 added the column ~08-24; there has simply been
> no image scan since. Do not read the all-NULL column as broken instrumentation.
>
> **➡️ `Gate: owner`, not work.** Everything actionable has shipped. One photo scan answers three
> questions at once: whether `input_tokens` falls from ~1,280, whether `latency_ms` falls with it,
> and what the upload leg costs (`payload_bytes` beside `latency_ms` is the subtraction this entry
> was built for).

**Owner report, 2026-08-23 (verbatim):** *"Ive noticed the nutrition scan for images is alot slower
than it used to be; can we investigate why - from taking the photo to getting the result is much
longer than before."*

**🔁 AMENDED 2026-08-23, after the pre-cut history became available.** The owner pointed at the
archived repo (`nekodas-neko/TrainingAI_Old`, 3,225 commits). It **corrects two claims below** — read
this before the original analysis, which is kept so the reasoning is auditable rather than quietly
rewritten.

**Correction 1 — the measurement window is far narrower than it looked.** AI instrumentation landed
in **#741 on 2026-07-22**; the earliest `ai_call_log` row is 2026-07-26. So "the AI call has always
been ~4.2 s" is only true **since 2026-07-22**, and *nothing measured it before that*. The original
wording ("NOT the regression, and that is measured") overstated what the data can support. If the
owner's "used to be" predates late July, `ai_call_log` structurally cannot see it.

**Correction 2 — the unbounded image payload is NOT the regression.** It is real and still worth
fixing, but it cannot be what changed: `Camera.getPhoto({ resultType: Base64, source: Prompt,
quality: 80 })` is **byte-identical since 2026-06-12**, never carried `width`/`height`, and
`@capacitor/camera` is pinned at exactly **8.2.0 with an unchanged integrity hash** for the whole
history. Demoted from "prime suspect" to a standing inefficiency — worth taking, but it will not
explain a slowdown on its own.

**✅ The one dated change to the scan's AI call: #112, `3219a475`, 2026-07-03** — *"AI usage batch:
structured output, response caching, chat tools, prompt hygiene, stream robustness"*. It rewrote the
route from **`generateText` + `JSON.parse(cleaned)`** to **`generateObject` + the Zod `ScanSchema`**,
and added the one-shot retry (`lib/ai/retry.ts`) in the same PR. That is **19 days before
instrumentation existed**, which is exactly why the latency table cannot see it.

**The mechanism was plausible and is now retired.** `generateObject` constrains decoding to a
schema, and CLAUDE.md *requires* structured output, so a revert was never on the table — but the
2026-08-24 probe measured the cost at **~10%**, not a regression. `maxOutputTokens`, `temperature`
and provider config are all still SDK defaults, and per the probe that is fine: the model was never
hitting a cap. **The provider uses native JSON mode** (`responseMimeType` + `responseSchema`, not
tool-calling) — checked in `@ai-sdk/google`, so the schema-strategy question is answered too.

**Retries ruled out.** `withAiLogging` starts its clock **before** `withAiRetry`, so a retry and its
1–1.5 s backoff would land in one row at roughly 9.7 s; the observed maximum is **5,013 ms**.

**Everything else, checked and unchanged:** model (`gemini-3.1-flash-lite` throughout),
`@ai-sdk/google` / `ai` (last moved 2026-05-23), and the route's later commits (#741 observability,
#1298 surfaced previously-swallowed failures). **`ScanSchema` is no longer byte-identical since
#112** — BF-11b reshaped it to `{identified, candidates[]}` on 2026-08-25; no image scan has run
since, so its effect is unmeasured along with everything else in point 3 below.

**How to reach the history, since this is the second entry to need it:** the archived repo is
attachable in-session via `add_repo` (`nekodas-neko/TrainingAI_Old`), then
`git fetch --unshallow` — a `--depth 1` clone cannot answer a "when did this change" question.

---

**⚠️ The model call is NOT the regression, and that is measured.** All 30 production scans:
image (~1,275 input tokens) **n=18, avg 4,168 ms** (3,498–5,013, 07-26 → 08-21); text (~215 tokens)
**n=12, avg 1,667 ms** (1,319–2,135). The earliest image scan on record (07-26) took 4,545 ms —
*above* the 18-call average — and the model is `gemini-3.1-flash-lite` on every row. **⚠️ Per
Correction 1 this window opens 2026-07-22 and says nothing before it**: the AI call is stable *now*,
not proven always to have been.

**Also ruled out by reading the path, all cheap or absent:**
- `rateLimit` is an in-memory `Map` (`lib/rate-limit.ts:97`) — no I/O on the request path.
- Exactly one network call per scan. `callScan` (`capture-step.tsx:68`) does a single
  `fetch('/api/nutrition/scan')`, and the route makes one `loggedGenerateObject` call.
- Nothing happens after the response. `handleScanResult`
  (`components/nutrition/food-logger-sheet.tsx:115`) is pure synchronous state, then `pushStep`.

**Standing inefficiency (demoted from prime suspect by Correction 2 — worth fixing, not the regression): the image payload is unbounded.**
`Camera.getPhoto({ resultType: Base64, source: Prompt, quality: 80 })` at `capture-step.tsx:113`
passes **no `width`/`height`**, so it returns the S25's full-resolution JPEG; base64 adds ~33% on top.
The gallery path is equally unbounded — `handlePhoto` runs `FileReader` over the raw `File` with no
resize. The server accepts up to **5 MB of base64** (`MAX_BASE64_BYTES`, `scan/route.ts:86`) under an
8 MB body cap, so multi-megabyte uploads are not rejected, just slow.

**The argument that makes a downscale free rather than a trade-off:** every image scan in the table
above reports **~1,275 input tokens**, within a 1,275–1,298 band across a month of real photos.
Gemini normalises an image to a fixed tile budget before the model sees it, so a 4 MB photo and a
400 KB photo produce the same token count and the same model work. **Bytes above that budget buy no
accuracy — they are pure upload latency.** That also explains the owner's phrasing: "taking the photo
to getting the result" is dominated by a leg that nothing in the app times.

**Field-name trap — verified against the pinned plugin source, not from memory** (per CLAUDE.md's
external-field-names rule, and this one would fail silently):
- The app calls `getPhoto(options: ImageOptions)`, and `ImageOptions` names the fields **`width`** and
  **`height`**.
- The sibling `takePhoto(options: TakePhotoOptions)` names them **`targetWidth`** / **`targetHeight`**.
- Writing the wrong pair is accepted by TypeScript's optional fields and ignored at runtime — a
  downscale that silently never happens, which looks exactly like "the fix did not help".
- Noted separately: `getPhoto` carries `@deprecated` in this pinned version, pointing at
  `takePhoto` / `chooseFromGallery`. Not urgent, but a migration would move which field names apply.

**Reuse rather than invent:** the saved-meal thumbnail entry above already prescribes an on-device
canvas downscale before upload, for the same reason on a different surface. Take that technique; the
target size here is larger (the model still has to read a plate of food), so pick it from the token
budget rather than copying 128 × 128.

**🔴 The gap that stops this being closed from data, and should be fixed alongside it:** nothing
times the client half. `ai_call_log.latency_ms` covers the model call only, so "photo → result" — the
thing the owner actually reported — has **no measurement anywhere**. Log the base64 payload size and
the client-side elapsed time as part of this work, or the next report of the same shape starts from
zero again.

**A second candidate that could not be tested from a sandbox session:** Railway container cold start.
`/api/nutrition/scan` is a low-traffic route, and a first request after an idle period pays
container spin-up ahead of everything above. Worth checking against deploy times before assuming
payload size is the whole story.

**✅ The commit is now named** — see the amendment at the top. The earlier version of this entry said
none could be, because the public repo holds a fresh history; the archived repo answers it.

**What would confirm it, in one pass — run the same photo three ways and compare.** (a) Current
`generateObject` path. (b) The same call with a flattened schema, or an explicit `maxOutputTokens`.
(c) Downscaled versus full-resolution upload, with the payload bytes logged. If (b) moves the number,
#112 is the regression and the schema is the lever. If only (c) moves it, the upload dominates after
all. If neither moves and wall-clock stays high, look at Railway cold start on this low-traffic
route — the one candidate that could not be tested from a sandbox session.

**Done looks like:** a photo scan uploads a bounded payload sized to what the model actually consumes;
the identification stays as accurate as it is today; and the client-side elapsed time is recorded
somewhere, so the next "it feels slow" starts from a number.

---

**✅ THE PAYLOAD BOUND SHIPPED 2026-08-23 (v1.333.4, Lane B). The rest of this entry is open and it
is all Lane A's.** [Journal](../overview/entries/2026-08-23-bounded-scan-photo-payload.md).

Both client paths bounded to a 1024 px longest edge — `getPhoto` gains `width`/`height` (the
`ImageOptions` pair, verified against pinned `@capacitor/camera` 8.2.0, **not** `takePhoto`'s
`targetWidth`/`targetHeight`), gallery via the new `lib/media/downscale-image.ts`. **Measured:
4000 × 3000 → 1024 × 768, base64 2,266,776 → 302,944 chars, −86.6%.**

**⚠️ Not closed, and NOT shown to be the owner's regression** — Correction 2 above already demoted
the payload to a standing inefficiency.

**✅ THE EXPERIMENT RAN 2026-08-24, against the real model, and it retires #112.** The entry asked
for exactly this — *"run the same photo three ways and compare"* — and a
`GOOGLE_GENERATIVE_AI_API_KEY` is present in a session sandbox, so it was run rather than reasoned
about. Same image, same system prompt, one variable at a time:

| arm | median | output tokens |
|---|---:|---:|
| (a) today's `generateObject` + `ScanSchema` | **1,700 ms** | ~485 |
| (b) same, plus `maxOutputTokens: 700` | 1,672–3,530 ms, no trend | ~500 |
| (c) same, schema **flattened** (no nested `ingredients` array) | **1,029 ms** | ~146 |
| (d) `generateText` + `JSON.parse` — the pre-#112 shape | **1,529 ms** | ~450 |

- **`maxOutputTokens` is ruled out.** Output tokens were unchanged (~500 either way) because the model
  was never hitting a cap. Capping something that is not binding does nothing, and (b) came out
  *slower* than (a) on the mean.
- **#112 is essentially exonerated.** `generateObject` costs about **10%** over the `generateText` +
  `JSON.parse` it replaced (1,700 vs 1,529 median, n=5 each, overlapping ranges) — not the 2× the
  entry's central hypothesis needs. **The structured-output conversion is not the regression**, so
  CLAUDE.md's no-`JSON.parse` rule costs nothing here and there is nothing to trade away.
- **Latency tracks OUTPUT tokens almost exactly**, and the nested `ingredients` array is ~70% of them:
  ~485 tokens → ~1.7 s, ~146 tokens → ~1.0 s. **(c) is not a proposal** — `sumIngredients`/`perServing`
  need the array — it isolates where the time goes.
- **Input tokens are constant at 1,093–1,275 regardless of image bytes**, confirming the entry's
  claim that bytes above Gemini's tile budget buy nothing.

**✅ THE PAYLOAD IS NOW MEASURED SERVER-SIDE (migrations 208 + 209).** `ai_call_log.payload_bytes`
records the decoded image size beside the model's own `latency_ms`, so a wall-clock complaint can be
answered by subtraction rather than re-argued. Verified through the real route on `pnpm dev`: a
17,591-byte photo logged `payload_bytes 17591`, `input_tokens 1275` — **exactly the production band**
— and a sibling `weekly-digest` row kept a NULL, which is the point of it being nullable.

**✅ BF-11b's schema change was checked against this entry's own finding, and it is NOT a regression
(measured 2026-08-25).** BF-11b (#480) replaced the flat `ScanSchema` with
`{ identified, candidates: [...] }` so a scan can return one meal per dish. Since the experiment
above established that **latency tracks output tokens almost exactly**, a deeper schema was a
plausible way to have made this entry's complaint worse — so it was measured rather than assumed.
Same prompt, same model, one variable, n=5 each:

| schema | median | output tokens (median) |
|---|---:|---:|
| flat, pre-BF-11b | 1,761 ms | 391 |
| `candidates[]`, shipped | **1,698 ms** | 409 |

The array wrapper costs **~18 output tokens (+4.6%)**, and the latency difference is *negative* and
far inside the run-to-run spread (flat 1,464–2,051; candidates 1,436–2,387). **The common
single-dish scan is unaffected.** A genuinely multi-dish scan does cost proportionally more output
tokens — but it is returning proportionally more meals, which is the feature rather than a
regression.

**What is left, and it is smaller than it was:**
- **The client leg still has no number** — `payload_bytes` prices the upload's *size*, not its
  *duration*, and "photo → result" starts on the device. That half is Lane B's (`components/**`); it
  can now send its elapsed time to a column that already exists.
- **Railway cold start on this low-traffic route** is the one candidate never tested, and after the
  above it is the leading one. It cannot be tested from a sandbox session.
- **Trimming the ingredients array** is the only measured latency lever left (~700 ms). Whether fewer
  ingredients or fewer per-ingredient fields is acceptable is a product question, not an engineering
  one.
- **Railway cold start** — still untestable from a sandbox.
- **Not device-verified:** only the gallery path ran here. A wrong field pair downscales silently
  never, which looks exactly like "the fix did not help".

---

## 2026-09-01 — closed by measurement, and it contradicts this document's own lever

Five image scans ran after the 1024 px bound shipped, so `payload_bytes` is populated and the two
regimes can be compared directly (`ai_call_log`, `section = 'nutrition-scan'`, `input_tokens > 1000`):

| | n | avg input tokens | avg latency | range | avg payload |
|---|---:|---:|---:|---|---:|
| before the bound | 17 | 1,280 | **4,146 ms** | 3,498–5,013 | — |
| after the bound | 5 | 1,460 | **2,671 ms** | 1,978–3,828 | 82.8 KB |

**Latency fell 36% while input tokens ROSE 14%.** The `r = +0.958` between latency and input tokens
that this investigation rests on does not survive the intervention: it was measured *within* one
regime, where image size moved both numbers together, and across the change they moved in opposite
directions. **Input tokens were not the lever.** Same lesson as CLAUDE.md's *A Correlation Across a
Model Change Is Not Evidence*, one layer over — a correlation inside a regime is not a prediction
about changing the regime.

**What is not claimed.** n = 5 against 17. Nothing here explains *why* input tokens rose under a
bound that shrinks pixels; worth a look if scan latency is ever raised again, not worth chasing now
that the number the owner feels has halved. The owner's *"took about 4 seconds from analysing photo"*
(2026-08-30, reported without complaint) is wall-clock and includes the upload and client work; the
model call that day measured **2,346 ms**. In the sense the original report meant, this **stopped
rather than was fixed** — no diff was ever traced to the original slowdown — but the 1024 px bound is
a real change and it is what the numbers moved across.

Backlog entry BF-4 carried this measurement and was removed from the queue on 2026-09-02, with
nothing owed.
