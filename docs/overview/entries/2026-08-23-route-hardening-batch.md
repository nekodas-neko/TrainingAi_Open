# 2026-08-23 — Three route-hardening items on one verification pass (Q-454, Q-455, Q-465)

**Branch:** `fix/route-hardening-batch` · **Lane A** · server only, ships via Railway

Batched because they verify identically — anonymous and signed-in calls against `pnpm dev` — not
because they share a subject. None of the three is a fix for an observed symptom; all three are
guards on paths that are reachable and unused, and each entry says so. That is worth stating,
because a change presented as a bug fix invites the next reader to look for the bug.

## Q-454 — three routes answered before establishing the caller was anyone

Found by calling all 122 GET routes anonymously. 120 revealed nothing. Three did:

| route | anonymous answer, before |
|---|---|
| `GET /api/day-log` | `400 {"error":"Missing date"}` |
| `GET /api/exercise-history` | `400 {"error":"Missing name"}` |
| `GET /api/push/subscribe` | `503 {"error":"Push not configured"}` |

**No data leaked.** Supply the missing param and both param routes returned 401 — the pre-auth code
only read a search param. The push one is the more interesting of the three: the key it guards is a
*public* VAPID key, so nothing secret was reachable; what was reachable was a fact about the
deployment — whether this instance has push configured — to anybody who asked.

All three now call `auth()` first. The rule is that security checks fail closed and fail *first*; it
is cheap to reorder today and expensive the day someone adds a param handler above the `auth()` call
that touches the DB.

**Verified the reorder breaks nothing:** `subscribeToPush` is called from one place,
`components/more/settings-panel.tsx`, which is a signed-in screen, and its very next call is a POST
that already required auth. An anonymous caller could never complete that flow.

## Q-455 — a thrown route answered with an empty 500

`GET /api/oura-ble/decoder-constants` read the constants through the same accessor the server
pipeline uses, and `JSON.parse(readFileSync(...))` threw straight out of the handler. The caller got
**500 with no body at all**, so a client doing `res.json()` stacked a parse exception on top of the
original fault and learned nothing from either.

Now caught, returning `{"error":"Decoder constants unavailable"}`. **Deliberately not a fallback:**
there is no degraded dequantisation table, and a client silently decoding step frames with the wrong
numbers would be worse than one that could not decode them at all. This turns a shapeless failure
into a legible one, nothing more.

The trigger the entry observed was environmental — the sandbox cannot reach the model-constants
bucket — and is not what was filed. The shape is. Worth noting beside LA-20 from earlier today: the
first-request path exists whatever the boot check does, and LA-20 was that path failing in
production for real.

## Q-465 — a check-in that says nothing is not a check-in

`POST /api/day-checkin` with a body of exactly `{}` returned **201** and wrote a row with every
metric null. That row is indistinguishable from a real check-in in which the user answered nothing,
and readiness is precisely the pillar where *"the user told us nothing"* and *"the user told us they
feel neutral"* must not collapse. It also moves `reevaluationKey(...)` in `/api/workout-data`, so a
hollow row can trigger a re-evaluation carrying no new information.

`dayCheckinHasAnswers` lives in `packages/shared/src/validation/day-checkin.ts`, beside the two
schemas that are already shared for the same reason: **the outbox reaches this table too**, and a
guard on the web route alone is how the two write paths drift — the failure this repo has hit in
three domains. The push branch rejects per-item and **not retryable**: a mutation carrying no
information will never carry any, so retrying it forever is the poison-pill shape the outbox exists
to avoid.

**What counts as an answer** is the whole design: the ten scales, an illness context, a non-blank
journal, or a non-empty sore-muscle list. Not `phase` or `date` (addressing), and **not the two
`*Touched` flags** — they describe whether a score-derived prefill was accepted, which is meaningless
without the scale they describe, and accepting them would let the exact hollow row back in.

**Checked for regression risk before choosing 400 over a silent no-op.** Both live writers
initialise their scale state from `NEUTRAL_SCALES` rather than from null, so they always send
numeric scales — a guard that rejected those would have broken a Save button on a screen where the
user *did* answer. Production agrees: all 50 of the owner's check-in rows carry answers, across
every column.

## The existing parity test was asserting the old contract

`push-mutations-web-parity.test.ts` had a case posting `{}` to both paths and expecting 201 — the
behaviour Q-465 removes. Its subject is phase defaulting, so both fixtures now carry one answer, and
the answerless case got its own parity assertion beside it. **An unchanged fixture there would have
been the test asserting the bug**, which is the failure mode worth naming rather than quietly
patching.

## Verified

Four mutations, each applied, run, reverted:

| mutation | fails |
|---|---|
| revert `day-log`'s ordering | `GET /api/day-log — no date` |
| remove the route's answers guard | 3 of the 5 day-checkin cases |
| remove the push branch's answers guard | 2 of the 4 outbox cases |
| remove the decoder-constants try/catch | `answers a failed read with JSON, not an empty 500` |

Full suite **552 files / 4,562 tests**; `pnpm check:rules` **52 of 52**. Live against a signed-in
`pnpm dev`: all five anonymous calls 401, `day-log`/`exercise-history` still 400 correctly *behind*
auth, `{}` and addressing-only rejected 400, one real answer 201, decoder-constants 200.

**Not exercised:** the APK. Nothing here is native, offline-first, safe-area or gesture work — three
route handlers and one shared predicate — so the device gate does not apply. The outbox half is
exercised through `pushMutations` against the local Postgres, which is the same code the device
calls, but not from a device.
