# 2026-08-25 — record provider cache hits on `ai_call_log` (Q-295)

**Branch:** `feat/ai-call-log-cached-tokens` · **Lane A** · migrations 222 + 223. No user-visible change.

**Stacked on `chore/drop-running-baselines` (Q-301b, #499) and must not merge before it** — see
*Ordering* below. That is a real constraint, not a preference.

## Why this and not the caching

Q-295 proposed adding explicit context caching to the Coach prompt. Taking it as the next buildable
Lane A item, I ran the measurement the entry itself asks for first, and it said don't build it —
Coach's latency had already fallen **9,557 ms → 1,489 ms** across its 22 lifetime calls, and it is no
longer the slowest surface. That re-measurement is its own PR (#500).

What survived is the reason the question could not be *settled*: **Gemini 3.x caches implicitly by
default**, `@ai-sdk/google` reports the hit as `inputTokenDetails.cacheReadTokens`, and `ai_call_log`
had nowhere to put it. So implicit caching may already have been doing the work the entry wanted to
do explicitly, and nothing in production could say. Adding an explicit cache in that state would be
an optimisation nobody could measure, stacked on one nobody could see.

## What shipped

- **222** — `ALTER TABLE ai_call_log ADD COLUMN IF NOT EXISTS cached_input_tokens integer`.
- **223** — the claude_ro view regen, because the schema is default-deny: a column with no view is
  unreadable, and the column would otherwise be invisible to the audit that motivated it.
- `readUsage` in `lib/ai/instrument.ts` — the single chokepoint every AI call already passes through,
  so all ~17 sections get this, not just Coach. Reads `inputTokenDetails.cacheReadTokens` first and
  falls back to the SDK's deprecated `cachedInputTokens` alias, so it works whichever a given
  provider version populates.

## The one decision worth not re-litigating

**Nullable, no default, no backfill.** `NULL` means *the provider reported nothing* (or the call
predates the column); `0` means *the provider reported a cache miss*. Those are different facts, and
a `DEFAULT 0` would have silently claimed every historical call was a measured miss — which is
exactly the direction that would make the cache-hit rate look worse than reality and justify work
that isn't needed. Same reason `readUsage` uses `??` and not `||`.

That distinction is the load-bearing behaviour, so it is the one the test targets, and the test was
**mutation-checked**: flipping `??` to `||` fails exactly one case (*"keeps a reported MISS as 0, not
null"*) and leaves the other five passing. A test that cannot fail is not evidence.

## Ordering

Migration 223 is generated from a local database that already has 220/221 applied, so it contains no
`claude_ro.running_baselines` view. Merged **before** #499 that would leave the table present in
production with its audit view silently removed. Filename sort order handles it within one deploy;
the constraint is only that #499 lands first.

Worth knowing generally, and it is not obvious from the files: **the view generator reads the live
local schema, not `schema.ts`**, so a regenerated view migration inherits whatever migrations the
local database happens to have applied. That is what makes stacked view regens order-dependent.

## Verified

- **594 test files, 4,883 tests, 0 failures** (`unit` 571/4,815 — six new — and `rollup` 23/68).
- `tsc --noEmit` clean · `pnpm lint` 0 errors (123 pre-existing warnings) · `pnpm check:rules`
  **Ran 57 of 57** · `check-migration-numbers` no collisions, next free 224 ·
  `check-export-coverage` OK at 84 tables · `check-backlog-pointers` OK at 201 entries.
- Confirmed `cached_input_tokens` appears in the regenerated views, and that the owner id passed to
  the generator appears nowhere in the output (Q-456 — views scope on
  `current_setting('app.claude_ro_owner', true)`).

## Not exercised

- **No real cache hit has been observed.** The column starts empty and fills only as calls are made;
  every test above uses a synthetic usage object. Whether Gemini is actually serving cached prefixes
  is precisely the open question, and answering it needs production traffic — Coach's last call was
  2026-08-18.
- The migrations have not run against production; that happens on the Railway deploy.
- Nothing native, offline-first, safe-area or gesture-related is touched, so no device smoke run is
  owed.

## Deliberately not done

`outputTokenDetails.reasoningTokens` sits in the same usage object and would cost about four more
lines. It is left out: Q-295's re-scope names the cache column and nothing else, and Q-170's
reasoning-token work is a different entry. Worth picking up there, not here.
