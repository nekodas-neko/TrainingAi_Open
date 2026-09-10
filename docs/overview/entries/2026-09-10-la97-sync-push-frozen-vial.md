## 2026-09-10 — LA-97: the freeze had no way to reach the server, and a correction to how I described it

Lane A, shipped alone (CLAUDE.md: never batch a sync-push change). LA-97 leaves the queue; **LA-98**
is filed for the half deliberately left out.

**⚠ First, a correction to this session's own earlier claim.** I described LA-97 as a live data bug
rewriting *"every offline supplement tick"*. The mechanism is real; **the damage so far is zero**,
and I should have measured before saying otherwise. Production holds **4 supplement logs**, the
newest 2026-09-07, and:

| | |
|---|---|
| logs with a frozen vial | **0** |
| logs with a non-null `taken_at` | **0** |
| vials in existence | **1, opened 2026-09-10** |

The first vial was created **today**, after every existing log — so no log has a frozen
reconstitution to lose. That makes this a fix landing *before* the first vialled tick rather than
after, which is a better outcome than the one I first described but not the one I claimed.

**What was broken, in four steps.** `upsertSupplementLog` freezes `takenAt` and the vial triple at
log time (OR-102a). Then:

1. **`getSupplementLogs` could not read them back.** `SELECT *` carried the columns; the row→object
   mapper listed ten fields and stopped. The freeze was **write-only**.
2. `enrichPayload` builds its push payload from that mapper, so it forwarded `amount`/`unit`/
   `doseText` and could not forward what it could not see.
3. The server's `supplement_logs` push branch accepted those same three.
4. `logSupplement` therefore re-read the **current** vial and stamped `taken_at` at **push time**.

Step 1 is the root cause and the reason it hid: it is CLAUDE.md's own mapper rule (*"when adding a
DB column, update EVERY row→object mapper"*, sessions 29 and 64) missed once more, and a missed
mapper fails silently by construction. Every test in the repo passed throughout.

**`logSupplement`'s `takenAt` fallback was already correct** — `dose?.takenAt != null ? … : new Date()`
— and still produced push-time timestamps, because nothing ever supplied one. A correct fallback
behind a caller that never calls is indistinguishable from no fallback at all, which is why three of
the four steps are upstream of it.

**#1073 widened the window while this sat.** `openedOn` is now a user-entered mix date rather than
always today, so "the newest vial by `opened_on`" can change without a new vial being entered —
a backdated mix reorders the selection a push-time re-read would land on.

**Mutation pass — 3 mutants, 1 control, one per step:** M1 (mapper reverted — the root cause) →
CAUGHT, 2 tests. M2 (server ignores the caller's vial) → CAUGHT, 2 tests. M3 (`enrichPayload` drops
`takenAt`) → CAUGHT. M4 control (`takenAt` null-check written as `== null` instead of truthily) →
SURVIVES. The behavioural tests drive the real server against local Postgres; the local half is
source-grepped, because native SQLite does not run in node — the same reason that suite exists.

**Split out as LA-98, not bundled:** `resolveLoggedDose` merges with `??`, so a replayed log whose
amount was genuinely null picks up the definition's *current* `default_amount` — the same class of
rewrite, one field over. Measured latent (1 of 4 logs has the shape, and it is long synced; the case
needs a mutation queued before a definition change and drained after). Fixing it needs three
surfaces to agree on absence and **changes web-route behaviour too**, which is not worth a second
semantic change inside a sync-push PR.

**Not exercised:** no device run, and the local half cannot execute in the sandbox
(`getLocalStore` returns null without native SQLite), so steps 1–2 are pinned by source-grep rather
than behaviour. The server half (steps 3–4) runs for real against Postgres. The end-to-end path —
tick offline, drain later, check the row kept its mix — is a **device** check and is owed; it is
the one thing here no sandbox test can stand in for.
