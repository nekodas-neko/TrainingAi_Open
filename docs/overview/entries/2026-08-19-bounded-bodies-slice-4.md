# 2026-08-19 — Q-322 slice 4: the AI and expensive routes

**PR #196** · branch `fix/bounded-bodies-slice-4` · Implementation Lane A · JS/server only.

Ten routes, the largest slice so far. These are the ones where an unbounded body costs a model call
as well as memory, and where two of them turned out to have no real schema bound at all.

| route | cap | derivation |
|---|---|---|
| `coach` | 8 MB | **measured against production** — below |
| `coach/threads` | 8 MB | the same payload on its way to storage |
| `coach/apply`, `coach/preview` | 256 KB | a patch of ≤8 changes |
| `builder-chat` | 256 KB | fully schema-bounded: 20 × 2,000 + 1,000 chars ≈ 50 KB |
| `generate-program` | 256 KB | see the unbounded arrays below |
| `nutrition/meal-plans/generate` (+ `/meal`) | 256 KB | largest array is 200 × 80 chars |
| `ai/health-insight` | 4 KB | an enum, a date, a boolean |
| `exercises/generate` | 4 KB | one 120-char name |

## `coach`'s cap came from production, not from a guess

Its schema caps a conversation at **60 messages** — but each message is `z.unknown()`, so it bounds
the count and nothing else. Rather than pick a number, the real table was measured through the
read-only endpoint:

```
msgs  max_msg_bytes  avg_msg_bytes
  20         52,571          9,463
```

Sixty of the observed maximum is 3.1 MB, so **8 MB is about 2.5× an already-pessimistic
construction** — a whole conversation of nothing but maximum-size messages — while still refusing the
20 MB body this sweep exists to stop.

**Stated honestly:** 52 KB is the *owner's* observed maximum, because `claude_ro` is row-scoped to one
user. It is a floor on the true maximum, which is exactly why the headroom is generous rather than
tight. The constant says so, and says not to lower it without re-measuring: a rejected body here
loses a live conversation.

## Two routes had no meaningful schema bound

`generate-program` takes `equipment` and `musclesToFocus` as `z.array(z.string())` with `.min(1)` and
**no `.max()`** — neither the element count nor the string length is capped, and both go into a model
prompt. Until those gain caps the byte limit is the only thing bounding what reaches the model, which
is written into the constant rather than left for someone to rediscover. `coach` and `coach/threads`
are the same shape at the message level.

That is a benefit of this sweep beyond the transfer cost, and it was not the stated goal: **converting
the read is what makes you read the schema.** Three slices running, it has also surfaced a missing
type check every time.

## Verified live

`pnpm dev`, seeded user. A 10 MB body at the eight small-cap routes and a 12 MB body at the two 8 MB
chat routes:

| | oversized | malformed | valid |
|---|---|---|---|
| all ten | **413** | **400**, never 500 | — |
| `exercises/generate` | | | **200** — "DB Lateral Raise" → "Dumbbell Lateral Raise", a real model call |
| `ai/health-insight` | | | **200** — a real insight generated for a seeded sleep night |
| `coach` | | | **200** — streamed `start → text-delta "OK" → finish` end-to-end |
| `coach/threads` GET | | | **200** |
| `coach`, `generate-program` | | | schema rejections unchanged (400 on an empty `messages`, on an empty `programName`) |

Full suite against the local DB: **489 files / 4,138 tests green**. Custom Rules 49 of 49.

## The stale-entry guard earned its place

Converting ten files at once tripped the baseline's *stale* branch — it lists files that no longer
have a bare read and fails until they are removed, so a converted file cannot silently keep an
allowance the next author would inherit. That is the half of a shrink-only ratchet that is easy to
leave out, and it caught this on the first run.

## Not exercised

Production, and the APK. No native, safe-area, offline-store or WebView surface is touched. The
coach's happy path was exercised with a **one-message** conversation — a 60-message one at the
measured maximum was not constructed, so the 8 MB cap is verified as *rejecting* 12 MB and as
*accepting* a small conversation, not as accepting a maximal one.
