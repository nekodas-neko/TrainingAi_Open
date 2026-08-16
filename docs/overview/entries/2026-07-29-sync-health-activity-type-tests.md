## 2026-07-29 — Test the sync-health activity-type guard, and correct two stale Phase 4 ledger rows

Branch `fix/sync-health-activity-type-tests`. Salvage from a superseded PR — no behaviour change.

### Why this exists: #903 was overtaken by #902

Two sessions independently picked up Q-25. #902 landed first with a better factoring (a shared
`lib/scale-ble/apply-reading.ts` both scale routes call), so #903 was left redundant and is not being
merged. Re-checking #903's diff against `main` line by line found exactly two things in it that
`main` does not already have; this PR carries those across and nothing else.

The scale day-keying half of #903 is **fully** superseded — `lib/scale-ble/__tests__/apply-reading.test.ts`
covers the backdated-reading, UTC-vs-local and trend-gate cases more thoroughly than #903's tests did.
Nothing salvaged there.

### 1. The activity-type guard shipped without a test

#902 fixed Q-25(a) — an unseeded `activityType` is an FK violation that threw out of the exercise
loop and 500'd `/api/sync-health`, losing the whole flush including the records that were fine — but
shipped no test for it. The guard has four distinct outcomes and none were covered.

Four tests added to `app/api/__tests__/sync-health.test.ts`:

| Case | Expected |
|---|---|
| seeded type | written through unchanged, `rejected` empty |
| unseeded type, `other` seeded | degraded to `other` **and still written**, degrade noted in `rejected` |
| unseeded + seeded in one flush | both write — the unknown one must not strand its sibling |
| unseeded type, `other` **not** seeded | only the offending record skips |

The third is the one that matters: it's the poison-pill property the whole fix exists to establish.

**Mutation-checked, not just green.** Neutralising the guard (`if (!knownTypes.has(...))` →
`if (false)`) fails 3 of the 4; the seeded-type case correctly stays green as the control. A test
that passes against the broken code proves nothing, and this file had no `exerciseSessions` coverage
at all before, so a vacuous pass was the live risk.

Note the mock repo needed `listActivityTypes` added — its absence was a latent trap. Every existing
test passes `exerciseSessions: []` or omits it, so nobody had hit `repo.listActivityTypes is not a
function` yet; the next person writing an exercise test would have.

### 2. Phase 4 was shipped but the ledger still said "ready to implement"

`docs/implementation-backlog.md` Q-1 listed Phase 4 as **"re-scoped 2026-07-29, ready to implement"**
— but #897 *is* Phase 4 ("Fetch only the Health tab being shown"). #897 rewrote the Phase 3 rows and
added the correction block in that same table and left its own row untouched. A future implementer
working the queue top-down would have rebuilt it.

Marked ✅ shipped (#897), carrying #897's own honest caveat rather than a bare tick: the 51→42 figure
is from `pnpm dev` in Chromium, and neither the device number nor "every card on all three tabs still
populates" is owner-verified.

The roadmap had the same drift in a second place: its `### Phase 4` section still describes the
**withdrawn** home-tab/`/api/home-bootstrap` premise, while the Phase 0 results section 40 lines
earlier says it was re-scoped to Health — the document contradicted itself. Added a superseded banner
pointing at the backlog for live status.

### Not verified

- **Nothing was run on device**, and nothing here can be — this PR adds tests and edits markdown.
- **The two caveats inherited from #897 are still open** and are now recorded rather than resolved:
  Phase 4's device request count, and whether every Health card on all three tabs populates against a
  real account. The seeded dev user is too sparse to settle the second.

No version bump — no user-visible change.
