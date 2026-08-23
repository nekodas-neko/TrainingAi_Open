# 2026-08-23 — Four request schemas made strict, and two exemption classes found doing it (Q-464)

**Branch:** `fix/strict-request-schemas-slice` · **Lane A** · server only

Q-464's ratchet shipped on 18 August and froze 89 non-strict request schemas across 63 files. This
takes it to **85 across 59**. Four is a small slice of 89 and is stated as such — what makes it
worth a PR is the other half, which is why the remaining 85 cannot be swept mechanically.

A non-strict Zod object silently **drops** an unknown key. On a date-bearing write that turns a
mistyped field into a successful write of the wrong day: `POST /api/body-metadata` with
`{"date":"2026-08-10","weightKg":81}` answered `200 {"success":true}` and wrote the weight on
*today*, because the contract's key is `localDate`.

## The four, each with its client read first

| route | its one client | keys sent |
|---|---|---|
| `POST /api/admin/timing-baseline` | `components/admin/time-audit-card.tsx` | `{ date }` |
| `POST /api/ai/health-insight` | `components/health/ai-insight-card.tsx` | `{ section, date, force }` |
| `POST /api/running-plan` | `components/running/plan-setup-sheet.tsx` | `goalKind`, `targetDistanceKm`, `timePerSessionMinutes`, `frameworkKey` |
| `POST /api/running-plan/override` | `components/running/running-plan-content.tsx` | `{ runType, durationMin }` |

Two are date-bearing, which is the priority the entry names.

## Two more exemption classes, measured rather than guessed

**A third-party SDK's wire format.** `/api/coach` is driven by `@ai-sdk/react`'s
`DefaultChatTransport`, which posts `{ id, messages, trigger, messageId }` — read out of
`node_modules/ai/dist/index.mjs`, where it builds that body whenever `prepareSendMessagesRequest` is
not supplied. The route's schema names only `messages`. **`.strict()` there would 400 every coach
message.** The wire format is not in this repo and moves with the dependency, so the rule is: read
the installed SDK before tightening any route it drives.

**`generateObject` response schemas.** The checker counts `z.object` and cannot tell a request
schema from a model-output schema. `builder-chat` has four and only one is a request; strictness on
the other three governs what the model may return, which is a different decision with different
consequences. Check what a schema is *for* before counting it a candidate.

Also moved into the outbox class: **`scale-ble/samples`**. Its client is the APK's Kotlin service,
and the APK does **not** update with a Railway deploy — so an old build can send a field a new
schema does not name. Same hazard as the outbox, wearing native clothes.

And one that looked convertible and is not: **`plan-meal-answers`**. Its client sends exactly the
schema's keys, but `plan_meal_answers` is an outbox domain — the tell was the comment
*"client-minted so the write is idempotent on outbox replay"*.

## The shortcut that does not work

In-repo JS clients ship with the server: the APK is a WebView loading Railway, so JS and server
always deploy together. That is true, and it is tempting to conclude a codemod is safe — a key
mismatch would be a bug either way. But it argues that a mismatch **is** a bug, not that there is
none, and a silent 400 on a rarely-exercised route is exactly the bug a codemod would introduce and
no test would catch. There is no substitute for reading each client. That reasoning is now in the
script's header so the next implementer does not have to re-derive it, or worse, act on it.

## Verified

Live against a signed-in `pnpm dev`, all four: a valid body still works, an unknown key now 400s.

```
POST /api/running-plan/override {"runType":"easy","durationMin":30}          → 404 (no plan; body accepted)
POST /api/running-plan/override {"runType":"easy","durationMin":30,"typo":1} → 400 Invalid body
POST /api/admin/timing-baseline {"date":"2026-08-23"}                        → 200
POST /api/admin/timing-baseline {"date":"2026-08-23","oops":1}               → 400
POST /api/ai/health-insight     {"section":"sleep","dat":"2026-08-10"}       → 400
POST /api/running-plan          {"goalKind":"easy_typo","nope":1}            → 400
```

The `health-insight` case is the entry's own failure mode: `dat` instead of `date` used to be
dropped and answered for today.

Full suite 547 files / 4,534 tests; `pnpm check:rules` 53 of 53, with the ratchet reporting
**85 across 59** and four rows deleted from its baseline so those files are held at zero.

**Not exercised:** the APK. Four route schemas, no native or offline-first path.
