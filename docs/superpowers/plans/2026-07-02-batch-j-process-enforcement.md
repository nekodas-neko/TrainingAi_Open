# Batch J — Process & enforcement (CI rules, device checklist, sw.js cache)

> Source: `docs/planned_upgrades.md` § Batch J. Three independent chunks, each its own small PR — execute in any order, one at a time. J1 is split into waves because some rules have known outstanding violations that must be fixed (by other batches) before their check can be enforced.

## Chunk 1 — J1 wave 0: baseline audit (no CI change)

For each candidate check below, run its grep locally against `main` and record the hit count in this file (edit the table in the wave-1/wave-2 lists into "hits: N" notes). This decides each check's wave and its allowlist. ~30 minutes, zero risk. Do this in the same session as wave 1 — it's the input to it.

## Chunk 2 — J1 wave 1: enforce the zero-hit rules

Add one step per rule to the `custom-rules` job in `.github/workflows/ci.yml`, copying the existing step shape (grep → if non-empty, echo the CLAUDE.md section name + hits → exit 1). Expected zero-hit today (confirm via wave 0; any rule with hits either gets its violations fixed in this PR if trivial, or moves to wave 2):

1. **No PRAGMAs in local SQLite upgrade statements** — grep `PRAGMA` inside `lib/sqlite/migrations.ts` `statements` arrays (a plain file-scoped grep for `PRAGMA` with an allowlist for the post-open site in `sqlite-service.ts` is enough). Guards the #27 class.
2. **No `pt-safe` stacked with another `pt-*`** — grep `className="[^"]*pt-safe[^"]*pt-[0-9]` (and single-quote/template variants) across `app/ components/`. Guards the session-172 class.
3. **Safe-area utility classes must exist** — extract every `pt-safe*`/`pb-safe*` token used in `app/ components/`, diff against definitions in `app/globals.css`; fail on any used-but-undefined class. Guards the `.pt-safe-or-4` (session 167) class. Small inline `bash`/`node` step.
4. **No nested `<button` inside `role="button"`/`<button` wrappers** — pragmatic two-line-window grep (`grep -A2 'role="button"' | grep '<button'` style); allowlist false positives inline. Guards the WebView-strip class.
5. **No `new Date().toISOString()` in client date writes** — extend the existing UTC-slicing step's pattern set with `toISOString()` usages feeding date fields if wave 0 shows zero hits; otherwise skip (the existing check already covers the worst form).

Each step's failure message names the CLAUDE.md section so the fix is self-serve. Verify: push a branch with a deliberate violation of each rule → CI fails with the right message → revert.

## Chunk 3 — J1 wave 2: checks gated on outstanding fixes

These rules have known violations today — the check ships **in the same PR as (or after) the fix that zeroes them**:

6. **No bare `fetch('/api` in client components** (must be `cachedFetch`) — blocked on **B2** (the ~17-site uncached-read matrix). Allowlist: non-GET calls, `lib/`, API-route internals. Add the step as `continue-on-error: true` with a hit-count echo now if useful, flip to enforcing when B2 lands.
7. **No `JSON.parse` in AI routes** (must be `generateObject`/schema) — blocked on **E1** (four hand-parsed routes). Scope: `app/api/**` files importing from `ai`/`@ai-sdk`.
8. **No `invalidateCache(` with inline key lists outside `lib/cache-groups.ts`** — wave-0 count decides: if the B1 quick-win (✅ #91) zeroed call-site lists, this is wave 1; any stragglers get routed through a group helper in this PR.
9. **`RECONCILE_TABLES`/`RECONCILE_COLUMNS` completeness** — parse `lib/sqlite/migrations.ts`: every `CREATE TABLE`/`ADD COLUMN` name in the migration statements must appear in the reconcile lists. Highest-value check of the set (guards the #85 class); needs a small node script (`scripts/check-reconcile.js`) rather than a grep — keep it under ~60 lines, no deps.

## Chunk 4 — J2: device smoke-test checklist

Write `docs/device-smoke-checklist.md` — one page, ~5-minute pass on the S25 after any APK-affecting merge. Sections: (1) safe-area — status bar + gesture bar on every new/changed screen, both themes; (2) offline round-trip — write (food/mood/body) → airplane mode → kill app → reopen → data renders; pull-to-sync drains on reconnect; (3) console — no `[initSQLite] failed`; (4) gestures — pull-to-sync doesn't swallow scroll, drag-reorder persists after navigation; (5) rendering — new cards/SVGs don't wipe sibling gradients (Samsung compositor), timers tick without jank; (6) notifications — rest timer/reminders fire at the expected minute. Then link it from CLAUDE.md's Communication section ("carry an explicit on-device verification step" → "run `docs/device-smoke-checklist.md`") in the same PR. Docs-only.

## Chunk 5 — J3: build-hash service-worker cache names

`public/sw.js` uses a manually bumped `ta-vN` cache name (forgotten twice → invisible deploys, sessions 55/74).

1. Inject a build id at build time: `next.config.ts` `env.NEXT_PUBLIC_BUILD_ID` from `process.env.RAILWAY_GIT_COMMIT_SHA ?? Date.now()`, and template it into `sw.js` — since `sw.js` is a static file, add a small build step (`scripts/stamp-sw.js` run in the `build` script) that rewrites the cache-name constant, or serve the SW from a route handler that interpolates it. Pick whichever the current `sw.js` registration supports with the least machinery — investigate `public/sw.js` + `ServiceWorkerRegistration` first (~15 min) and note the choice in the PR.
2. Keep the activate-handler's old-cache cleanup (it deletes non-matching names — verify it deletes *all* old `ta-*` caches, not just the previous one).
3. Remove the "bump sw.js cache version" step from CLAUDE.md's WebView-gotchas bullet in the same PR (replace with "cache name is build-stamped — no manual bump").

**Risk note:** a broken SW ships broken caching to the only real device — test the full update cycle on `pnpm dev`/`pnpm build` + local serve (register → deploy new build → old caches deleted → new assets served) before merging, and verify on the S25 after deploy that a subsequent deploy lands without a manual bump.

## Wrap-up (per chunk)

- Chunks are independent PRs; each: `pnpm tsc --noEmit && pnpm lint && pnpm test` (chunks 4 is docs-only — CI green suffices).
- Chunk 2/3 verification is meta: deliberately violate each new rule on a scratch branch and watch CI fail correctly — a check that never fires is worse than none.
- On ship: tick the J1/J2/J3 bullets in `docs/planned_upgrades.md`; chunks 4 and 5 also touch CLAUDE.md as described.
