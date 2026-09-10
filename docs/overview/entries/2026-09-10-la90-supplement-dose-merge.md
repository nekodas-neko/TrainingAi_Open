## 2026-09-10 — LA-90: one merge for both supplement write paths, and the live bug found beside it

Lane A. `resolveLoggedDose` in `packages/shared/src/nutrition/supplement-dose-freeze.ts`, called by
`logSupplement` (server) and `upsertSupplementLog` (local store). LA-90 leaves the queue; **LA-97 is
filed and is the more important half.**

**The divergence, confirmed against `main`.** The server merged the caller's dose against the
definition **per field** (`amount ?? defaultAmount`, same for `unit`). The local store was
**all-or-nothing**: it read the definition only when `amount`, `unit` and `doseText` were all null,
and otherwise took the caller's triple as given. A caller supplying only `amount` got the
definition's `unit` online and a null one offline — and the offline row wins, because a pushed
mutation carries what the device recorded.

**Per field is the behaviour kept**, because it is the one the server already had: sharing a merge
must not quietly re-decide what a log stores. The local store now reads the definition whenever
*any* field is missing rather than only when all are, which is what per-field needs to have
something to merge against; a caller with a complete triple — the sync engine replaying a log —
still skips the query.

**The entry's reassurance was wrong, and it is the ninth today.** It says *"the supplements page
passes no dose at all"*. `supplements-section.tsx:55` passes `{ amount, unit }` whenever there is a
prompted amount, to the local store **and** to the API fallback. The divergence still cannot fire,
but for a different reason than the entry gives: the log route and the push handler each normalise
to a complete triple before `logSupplement` sees one, and the page's `s.unit` mirrors the server's
`owns.unit`. That second half is an accident of the client holding fresh data, not a guarantee —
and it is least reliable offline, where a stale local mirror is exactly what you have.

**Mutation pass — 3 mutants, 1 control.** M1 (all-or-nothing restored — the divergence itself) →
CAUGHT, 2 tests. M2 (free text frozen against the caller's amount rather than the resolved one) →
CAUGHT, 3 tests. M3 control (returned keys reordered) → SURVIVES. The source-grep test in
`supplement-dose-chain.test.ts` was updated rather than deleted: it now pins the delegation to
`resolveLoggedDose` and forbids a local `freezableDoseText(` call, which is a stronger claim than it
made before — the free-text rule cannot be re-implemented locally without also un-sharing the merge
around it.

**The live bug found beside it, filed as LA-97 and NOT fixed here.** The same two functions drop
`takenAt` and the frozen vial triple on the way to the server. `upsertSupplementLog` freezes both at
log time (OR-102a); `enrichPayload` forwards only `amount`, `unit`, `doseText`; the server's push
branch accepts only those three; so `logSupplement` stamps `takenAt: new Date()` — **push time** —
and re-reads the **current** vial. The local code's own comment describes exactly this: *"Stamping
it server-side at push time would record whatever vial is current when sync happens, which is the
retroactive rewrite the freeze exists to prevent."* It happens one layer up, because the push path
was never extended past BF-3's three fields when OR-102a added four more.

**A third piece of the same gap, found before this PR merged and folded into LA-97.**
`getSupplementLogs` does `SELECT *` and its row→object mapper lists ten fields, none of them the
four OR-102a added — so `enrichPayload` could not forward `takenAt` or the vial triple even if it
asked. That is the root cause, and it is CLAUDE.md's own mapper rule (*"When adding a DB column,
update every row→object mapper"*, sessions 29 and 64) missed once more. It reorders LA-97's fix:
surface the fields in the reader FIRST, or the push wiring is a silent no-op that passes every test.

It is deliberately not fixed in this PR: **CLAUDE.md says a sync-push change never ships batched**,
because its revert is a corrective migration rather than a git revert. Bundling a live data bug into
a trap-fix would also have made both unreviewable, which is the same reason OR-104 left LA-90 out of
its own PR.

**One filing mistake, corrected in the same session.** LA-97's first draft used `⛔` to mark "ships
alone", and `next-item.js` parked it as *not implementable* — the exact trap this session has been
recording, walked into while writing about it. `⛔` means the entry cannot be built; a batching
constraint is neither a gate nor a blocker. Removed, and the entry now says so in prose with the
mistake on the record.

**Not exercised:** no device run. `upsertSupplementLog` cannot execute in the sandbox (native SQLite
returns null from `getLocalStore`), so the local half is verified by source-grep plus the shared
function's own behavioural tests — which is what `supplement-dose-chain.test.ts` exists for and says
about itself. The server half runs for real. No UI changed, so no screen was exercised.
