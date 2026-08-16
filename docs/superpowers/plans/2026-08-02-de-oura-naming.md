# Plan — remove vendor naming from the app

_Created 2026-08-02. Owner decision: "we should remove every instance of 'Oura this Oura that' as we
are creating a device agnostic type build." Implements
[`docs/device-agnostic-source-architecture.md`](../../device-agnostic-source-architecture.md) §4b.
Backlog entry: **Q-42**._

## Scope, measured

| Layer | Count | Verdict |
|---|---|---|
| User-visible strings in `app/` + `components/` | **~26** | **Phase 1 — do this** |
| All `Oura` references in `.tsx` | 182 | Phase 2 — identifiers |
| `oura_*` in `lib/data/postgres/schema.ts` | 22 | Phase 3 — own migration |
| Repo-wide `oura` references | 2,813 | not a rename, a project |

**Phases are separately mergeable and separately valuable.** Phase 1 delivers the owner's actual
request — the app stops presenting as an Oura client — for a fraction of the cost. Phases 2 and 3
are hygiene and carry real regression risk. Do not bundle them.

---

## Phase 1 — user-visible copy (branch: `refactor/de-oura-user-copy`)

**The whole owner-facing goal lives here.**

1. Enumerate candidates:
   `grep -rn ">[^<]*Oura\|'Oura\|\"Oura" components/ app/ --include=*.tsx`
   Triage by hand — the grep over-matches identifiers and under-matches template literals.
2. Replace with source-neutral language. Prefer naming the *thing* over the *vendor*:
   "Ring", "Your ring", "Connected device", "Wearable", or just the metric name. Where a specific
   device genuinely must be named (a pairing screen, a connection error), name it from data — the
   user's configured source — not a literal.
3. Admin-only surfaces (`app/admin/**`) may keep vendor names. They are diagnostic, the vendor is
   the subject, and neutralising them makes debugging harder. **State this exemption in the PR** so
   a later sweep doesn't "finish the job" and undo it.
4. Screenshot the changed screens at ≤640px. Copy changes break layout — a longer replacement
   string wraps a card or clips a tab label.

**Not in scope:** identifiers, filenames, table names, comments, docs.

---

## Phase 2 — internal identifiers (branch: `refactor/de-oura-identifiers`)

Component names, props, local variables, cache keys.

**Cache keys are the trap.** Renaming a `cachedFetch` key without updating every read site *and*
every `lib/cache-groups.ts` invalidation group is the single most repeated bug class in this project
(12+ incidents). Per `CLAUDE.md`: delete the legacy key from **every** seed site and add the new one
to the invalidation groups **in the same PR**. A renamed key that a group still invalidates by its
old name is a permanent staleness bug.

Do this file-by-file with the full gate between batches. There is no reward for doing it in one PR.

---

## Phase 3 — database tables (branch: `refactor/de-oura-schema`, own plan required)

`oura_daily`, `oura_heartrate`, `oura_daily_derived`, `oura_daily_summary`, `oura_raw_samples`,
`oura_bucket`, `oura_tokens`, `oura_ble_clock_anchors`, and more.

**Do not start this without writing its own plan.** A table rename here touches:

- the Postgres migration (with a claimed number against both the directory *and* open PRs)
- `lib/data/postgres/schema.ts` and every slice
- the **local SQLite schema**, its migration list, `RECONCILE_TABLES` and `RECONCILE_COLUMNS`
- `getSyncDelta` / `pullDelta` / `applyDelta` domain flags and mappings
- the `claude_ro` view generator (regenerate into a **new** migration number — never edit an
  applied one)
- every read path

**The local-store half is the dangerous half.** That file has silently killed the local DB twice
(#27, #85), and a rename is exactly the shape of change that does it. Any rename must land as
additive-then-cutover, never a bare `ALTER TABLE RENAME` that a partially-upgraded device can't
reconcile.

**Honest cost/benefit:** Phase 3 changes nothing a user can see. Its only argument is that a public
repo reads as vendor-neutral. Weigh that against the risk before starting — and consider that
`oura_raw_samples` is genuinely Oura-specific *by nature* (it holds that ring's BLE frames), so a
neutral name would be less accurate, not more. **A defensible endpoint is: rename the generic
tables, keep the genuinely source-specific ones.**

---

## Sequencing

Phase 1 is independent — take it any time. Phase 2 after Phase 1 (smaller diff to reason about).
Phase 3 only if the public-repo cut (Stage 4 of the goal layout) actually needs it, and only with
its own plan.
