# A code comment says "match every sibling delete"; it is the only route that does

**Date:** 2026-09-05 · **Agent:** Review 📖 (sweep 47) · **Pillars:** `[platform]` `[nutrition]`
**Lens:** the baton's top item — the mutating routes that carry a `try {` were checked for whether
they map a refusal at all, never for whether they map it to the **right** status.

`app/api/activity-logs/route.ts:70` answers `404` when a delete matches no row. The comment above it
states why:

> *"Match every sibling delete: 404 for both a nonexistent id and someone else's."*

**Six sibling deletes answer `200`.** For a nonexistent id, and — measured with a second account — for
someone else's. The comment has the direction backwards: Q-556 did not bring this route in line with
its siblings, it made it the only one of seven that behaves that way.

Separately, one route of the thirteen that call a typed-throwing repository method does not use the
route-boundary mapper, and answers `500` with an **empty body** for a plain not-found, writing an
`error_events` row for a request that was correctly refused.

---

## 1. Method, and what it does not establish

Run against `pnpm dev` on the seeded local Postgres with two real accounts. **Every probe is paired
with a control**, because a 4xx usually names a different missing field than the one under test:

- Each dynamic delete route was sent a **malformed** id (`not-a-uuid`) beside the **well-formed but
  nonexistent** one. The malformed probe returning `400 Invalid id` proves the route matched, the
  handler ran and its guard fired — so a `200` on the sibling probe is an answer, not a routing
  accident.
- The cross-account row was **read back out of Postgres** afterwards. A `200` alone cannot
  distinguish "deleted it" from "ignored it safely", which is the entire finding.
- `PATCH /api/admin/activity-types` was sent the same payload twice with one field changed.

**What this does not establish.** This is the **web** build: `getLocalStore()` returns null, so the
offline-first clients take their API fallback. On device, `manage-supplements-sheet.tsx` and
`injury-sheet.tsx` write locally and `return` before the fetch, so for those two surfaces the path
measured here is the fallback rather than the primary. The routes answer identically to every
caller. Nothing native, safe-area or Samsung-WebView is in scope. No production data was read — the
cross-account case is one the row-scoped `claude_ro` views structurally cannot see, which is why it
was built locally.

## 2. RV-45 — the decision was made, and reached one of seven routes

`DELETE /api/activity-logs`, with its control:

```
{"id":"00000000-0000-4000-8000-000000000000"}  ->  404 {"error":"Not found"}
{"id":"not-a-uuid"}                            ->  400 {"error":"Invalid body"}
```

Every sibling, each with the same malformed-id control returning `400 Invalid id`:

| Route | nonexistent id | |
|---|---|---|
| `supplements/[id]` | **`200 {"ok":true}`** | reports success |
| `supplements/[id]/log` | **`200 {"ok":true}`** | reports success |
| `injuries/[id]` | **`200 {"ok":true}`** | reports success |
| `nutrition/food-logs/[id]` | **`200 {"success":true}`** | reports success |
| `nutrition/saved-meals/[id]` | **`200 {"success":true}`** | reports success |
| `nutrition/meal-types/[id]` | **`200 {"success":true}`** | reports success |
| `admin/activity-types` (`?id=`) | **`200 {"ok":true}`** | reports success |
| `nutrition/meal-plans/[id]` | `404 Not found` | correct |
| `phase-sets/[id]` | `404 Phase set not found` | correct |

**The "someone else's" half of the claim, measured directly.** A second account deleted a supplement
owned by the first:

```
DELETE /api/supplements/3de11ac1-…   as zero@local.dev  ->  200 {"ok":true}
SELECT … FROM supplements WHERE id='3de11ac1-…'         ->  row present, owner unchanged
```

**Ownership is enforced. The answer is what is wrong.** The row survives and the scoping works; the
route refuses correctly and reports the refusal as a success. Nothing distinguishes it — no status,
no body difference, so no `error_events` row and nothing to alert on.

### This contradicts an earlier decision, and the newer one has already shipped

The 2026-08-18 write-surface review considered these exact routes and **deliberately did not file
them** ([write-up](2026-08-18-write-surface-not-found.md) §2), naming the same seven and arguing:

> *"`DELETE` is idempotent by HTTP convention, the desired end state (row absent) genuinely holds,
> and the client's outbox is correct to treat the mutation as done."*

**That argument is sound for the case it considered and false for the one it did not.** For the
owner deleting their own already-deleted row, the end state does hold and there is no bug. In the
cross-account case the desired end state is *not* "row absent" — the row is present and correctly
so — and the route still answers `200`. The premise fails, so the conclusion does not carry.

The project then reached that conclusion independently: Q-556 flipped `/api/activity-logs` to 404
"for both a nonexistent id and someone else's". So the repo held two positions, resolved the newer
way, shipped it on one route, and the comment recording the change asserts a consistency that does
not exist.

### Nothing blocks aligning the rest

Q-556's comment names the precondition that made a 404 unsafe before it — *"a row created via
`queueMutation` but not yet pushed"*, reconciled by the push arm since Q-328. **That precondition
holds identically for the siblings**: `supplements`, `supplement_logs`, `injuries`, `food_logs` and
`saved_meals` are all declared outbox domains in `SYNCED_MUTATION_DOMAINS`, exactly as
`activity_logs` is. `meal_types` and `admin/activity-types` have no outbox path at all, so no race
exists there to begin with.

### Why it is not merely cosmetic

The clients gate on the status alone and act on it:

```ts
// components/nutrition/manage-supplements-sheet.tsx:166
const res = await fetch(`/api/supplements/${id}`, { method: 'DELETE' })
if (!res.ok) throw new Error()
onChanged(supplements.filter(s => s.id !== id))
toast.success('Supplement deleted')
```

`injury-sheet.tsx:179` has the same shape. On any path reaching the API — the web build always, the
device whenever the local store is unavailable — a delete that removed nothing drops the row from
the list and confirms it to the user. The row is still on the server, so it returns on the next
pull.

## 3. RV-46 — the route-boundary mapper reaches twelve of thirteen

`lib/api/route-errors.ts` is the single mapper (Q-463): a repository throwing `NotFoundError` or
`UserFacingError` becomes a status instead of a 500. Its header states the purpose —

> *"the point is to clear correctly-refused requests out of that table"* … *"Four of the five routes
> this fixes returned an **empty** body, so a client calling `res.json()` threw a parse exception on
> top of the failure and never rendered its error state."*

Eighteen repository methods throw a typed error; thirteen mutating routes call one; **twelve use the
mapper.** The thirteenth wraps only `requireAdmin` in its `try`, leaving
`repo.updateActivityType(...)` uncaught on the handler's last line:

```
PATCH {"id":"walk",                  "sortOrder":1}  ->  200  {"activityType":{…}}
PATCH {"id":"no-such-activity-type", "sortOrder":1}  ->  500  (empty body)
```

Same shape, one field changed. `updateActivityType` throws `NotFoundError('Activity type')` at
`adapter.ts:2583`; with nothing to map it, Next's default handler answers 500. Both symptoms the
helper's header names. Read back straight after the probe:

```
PATCH /api/admin/activity-types | server | Activity type not found | 2026-09-05 03:18:12
```

A correctly-refused request, recorded as a server fault, in the table the helper exists to keep
clean.

**Low severity and filed as such** — admin-only, one caller (`activity-type-manager.tsx:146`). It is
worth an entry because it is the last unconverted site of a class the repo already decided how to
fix, and the fix is one line.

## 4. Clean, recorded as results

- **The retryable-write classifier reaches every push domain.** Q-475's `isRetryableWriteError` has
  exactly one call site, which reads like the "helper that did not reach" shape this session was
  hunting — but that site is the per-mutation `catch` in `pushMutations` (`adapter.ts:5088`),
  wrapping every domain branch. A dead database is classified retryable for all of them.
- **`/api/complete-workout`'s blanket 404 is recoverable, and was the first hypothesis.** Its
  `catch` wraps the whole domain operation and answers `404 Session not found` for any throw, with a
  comment conceding the 404 is "possibly-misleading". It does not lose the write: the client treats
  **any** non-ok as a signal to queue (`workout-screen.tsx:1526`), `complete_workout` is a declared
  outbox domain, and the push path re-runs it under the classifier above. Filed as nothing.
- **Four fixed-`400` catch blocks are correctly scoped.** `ai-periodization/*/respond`,
  `*/transition`, `baseline/complete` and `workout-review/*/apply` each answer a flat 400 from a
  `catch` — the shape that would misreport a server fault — but in all four the `try` wraps only
  `readJsonLimited` + `Schema.parse`.
- **The `DELETE /api/admin/activity-types` in-use branch is sound**: a type with a referencing
  `activity_logs` row returns `409` and is preserved.

## 5. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-45** | `[platform]` `[nutrition]` | Q-556 decided a delete that matched nothing answers 404 and shipped it on one route; six siblings still answer `200` for a nonexistent id and for another account's row, and the fix comment claims the opposite |
| **RV-46** | `[platform]` | `PATCH /api/admin/activity-types` is the one route of thirteen without the Q-463 mapper: 500 + empty body + an `error_events` row for a plain not-found |

## 6. Method notes

- **A prior review's *decision* is a claim too, and the honest move is to find its boundary.** The
  2026-08-18 review explicitly declined to file these routes, and re-filing them flat would have
  been wrong: its idempotency argument is correct for the case it tested. What it did not test was
  the cross-account case, where its stated premise — the desired end state holds — is false. The
  finding is the boundary, not the reversal.
- **A control can be mislabelled and still look like a result.** The first in-use control for
  `DELETE /api/admin/activity-types` deleted `walk` and returned `200 {"ok":true}`, read as "the 409
  branch is dead". It was not: `activity_logs` was empty, so nothing was in use and the delete was
  simply correct. **Assert the precondition your control depends on**, or it tests what the probe
  tests.
- **Two identical responses are two failed probes, not a result.** The first pass at
  `/api/activity-logs` sent the id as a query param; the route reads a body, so ghost and malformed
  both returned `400 Invalid body` — which reads as "it rejects everything". Both had missed the
  handler.
- **A malformed id is the cheapest control for a dynamic route** — one extra request, no fixture,
  and it proves the handler ran.
- **A one-call-site helper is not automatically an unreached one.** `isRetryableWriteError` looked
  like this session's expected pattern and is its opposite: one call site placed where it covers
  every branch. Check where the site *sits* before counting it.
