# Review sweep 47 — a comment claiming consistency, on the only route that has it

**Date:** 2026-09-05 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-47` · Docs only.

The baton's top lens: the mutating routes that carry a `try {` were checked for whether they map a
refusal at all, never for whether they map it to the **right** status.

`app/api/activity-logs/route.ts:70` answers 404 when a delete matches nothing, and its comment says
why: *"Match every sibling delete: 404 for both a nonexistent id and someone else's."* **Six
siblings answer 200 to both.** Q-556 did not bring that route in line with its siblings; it made it
the only one of seven that behaves that way, and recorded the opposite.

Probed live, each beside a malformed-id control returning `400 Invalid id` so the handler is known
to have run: `supplements/[id]`, `supplements/[id]/log`, `injuries/[id]`,
`nutrition/food-logs/[id]`, `nutrition/saved-meals/[id]`, `nutrition/meal-types/[id]` and
`admin/activity-types` all answer 200 for a row that does not exist. `nutrition/meal-plans/[id]` and
`phase-sets/[id]`, in the same tree, answer 404.

The second half of the comment's claim was measured directly with a second account: deleting the
first user's supplement returned `200 {"ok":true}`, and the row was still in Postgres afterwards
with its owner unchanged. **Ownership is enforced — the answer is what is wrong.** A correct refusal
is reported as a success, so nothing distinguishes it, and nothing reaches `error_events`.

**This did not simply reverse an earlier call.** The 2026-08-18 write-surface review named these
exact seven routes and deliberately declined to file them: *"DELETE is idempotent by HTTP
convention, the desired end state (row absent) genuinely holds."* That is right for the owner
deleting their own already-deleted row, and re-filing it flat would have been wrong. It is false in
the cross-account case, where the row is present and correctly so — the premise fails and the
conclusion does not carry. The finding is the boundary, not the reversal. Q-556 reached the same
conclusion independently and shipped it on one route.

Nothing blocks aligning the rest: the precondition Q-556 names — a row queued via `queueMutation`
but not yet pushed, reconciled by the push arm since Q-328 — holds identically for every sibling
domain, all of which are in `SYNCED_MUTATION_DOMAINS`.

**RV-46, low severity:** `PATCH /api/admin/activity-types` is the one route of thirteen calling a
typed-throwing repository method without the Q-463 mapper. Its `try` wraps only `requireAdmin`, so
`updateActivityType`'s `NotFoundError` reaches Next's default handler: same payload, one field
changed, `200` for a real id and **`500` with an empty body** for a missing one. Both symptoms
`route-errors.ts` names in its own header, and it files the refusal into `error_events` as a server
fault — the table that helper exists to keep clean.

**Clean, recorded as results.** `isRetryableWriteError` has one call site and is *not* this session's
expected "helper that did not reach": the site is `pushMutations`'s per-mutation catch, covering
every domain branch. `/api/complete-workout`'s blanket 404 does not lose the write — the client
queues on any non-ok and the outbox replays it under that classifier. Four fixed-400 catch blocks in
`ai-periodization/*` and `workout-review/*/apply` wrap only the body parse, so 400 is right.

**Not exercised:** the device. This is the web build, where `getLocalStore()` returns null and the
offline-first clients take their API fallback — on device, supplements and injuries write locally
and return before the fetch, so for those two surfaces the measured path is the fallback. No
production data was read; the cross-account case is one the row-scoped `claude_ro` views cannot see,
which is why it was built locally.

Write-up:
[`docs/reviews/2026-09-05-delete-reports-success-for-nothing.md`](../../reviews/2026-09-05-delete-reports-success-for-nothing.md).
