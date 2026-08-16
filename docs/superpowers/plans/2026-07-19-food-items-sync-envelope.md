# Fix: `food_items` outbox domain dropped by the sync push envelope (D-1, critical)

**Source:** deep review `docs/reviews/2026-07-18-deep-app-review.md` §D (D-1, adversarially
verified REAL/critical; also D-2, D-5). Branch: `fix/food-items-sync-envelope`.

## Problem

`lib/sync/mutation-schema.ts:9` — the push envelope's domain enum omits `'food_items'`, while
`lib/nutrition/log-food.ts` (`logFoodEntries`) queues a `food_items` mutation (client-minted id)
*before* the `food_logs` mutation for every new food. On the S25 APK the local-store branch is
taken **even when online**, so:

1. `POST /api/sync/push` (`route.ts:32-43`) silently filters the `food_items` mutation — no error
   row is returned;
2. the client (`lib/local-store/sync-engine.ts:561-574`) treats the missing result as confirmed and
   **deletes the outbox row**;
3. the paired `food_logs` mutation fails `foodLogRefsValid` (`slices/nutrition.ts:210-217`) because
   the item never reached the server → **dead-letters**;
4. the adapter's fully-built `food_items` branch (`adapter.ts:3322`) is unreachable dead code.

No healing path exists (web POST fallback isn't taken while the store is available; pull can't
return an item the server never got; saved-meals POST is a different flow). Every new/scanned food
logged on the APK since the `food_items` domain shipped is server-absent, and its log row is
dead-lettered. Local UI still shows the data (local-first read), which is why it's silent.

## Tasks

1. **One-line fix:** add `'food_items'` to the domain enum in `lib/sync/mutation-schema.ts`.
2. **Domain-coverage test (D-2):** a CI-runnable unit test asserting the envelope enum ⊇ every
   domain string `queueMutation` is called with (grep-derived fixture or export a canonical
   `SYNCED_MUTATION_DOMAINS` list used by both sides), so a future new domain can't repeat this.
   Note `scripts/check-push-mutations.js` only greps `this.db`/`sql` usage — it cannot catch
   envelope gaps, and the existing parity tests skip in CI and bypass the push route.
3. **Recovery sweep:** on app open (or More-tab sync screen), re-queue dead-lettered `food_logs`
   mutations whose failure was the FK check, after re-queueing their `food_items` from local rows
   (`sync_status != 'synced'`). Bounded, idempotent, one-shot per row.
4. **Verify** with the local dev DB: queue a new-food log through the local-store path, push, and
   confirm both rows land server-side; re-run push with a pre-seeded dead-letter and confirm it
   heals. `pnpm test` + the new coverage test green.
5. **D-5 note:** `food_items` `applyDelta` has no clobber gate — verified safe today (items are
   immutable client-side); leave as-is, documented here.

## Out of scope

Broader dead-letter surfacing (P5 `2026-07-19-error-surfacing-standard.md`).

## Not device-verified surfaces

The APK local-store branch itself (native SQLite) — the fix is server/JS and testable in sandbox;
an on-device smoke (log a new food online, confirm it appears server-side) is the final gate.
