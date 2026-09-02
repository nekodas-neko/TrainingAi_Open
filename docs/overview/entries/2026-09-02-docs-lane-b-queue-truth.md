## 2026-09-02 — Q-48 F6 applied, Q-48 to Lane A, Q-51 gated on the device it needs

**Branch:** `lane-b/next` · **Lane:** B · **No version bump** — queue edits only.

Working the queue top-down, the three entries above the floor all turned out to be misfiled rather
than merely hard. None was startable; two are now correctly marked, and one had a real contradiction
inside it.

### Q-48 F6 — the gate was already released, and one entry contradicted itself

F6 asked to *"state the deferral on Q-32; decide whether the Q-1 gate survives."* The gate **does not
survive**: Q-49 released it (*"releases the Q-1 + Q-30 gates on Q-32, which were sequencing
preferences rather than technical dependencies"*) and the public cut has since happened.

**Q-1b said both things at once.** Its 2026-09-01 note reads *"Q-31 and Q-32 no longer wait on this —
Q-49 released those gates"*, and 110 lines further down it still carried *"Q-31 and Q-32 stay ⛔
blocked behind it"* from 2026-08-02. The stale line survived the release, so two entries read as
blocked by a deferral that no longer holds. Struck, with both sides cited. **Q-1b's own deferral
stands** — only its downstream gates are gone.

There is no Q-32 *entry* to state a deferral on: it is referenced in prose but not queued. So the
edit landed where the contradiction actually was.

### Q-48 → Lane A

What remains is F4 (a table-by-table residency matrix over 70 `pgTable`s against 37 local tables) and
F5 (a golden-vector parity harness for the sync rewrite, plus a native replacement for
`check-push-mutations.js`). Both are `lib/data/**` / `lib/local-store/**` / `packages/shared/**`
subjects — the engine, whichever lane writes the prose.

Leaving `Lane:` unstated put it on Lane B's READY list as `⟨lane unstated⟩`, which is where it
stalled. An entry with no lane is not neutral; it is offered to everyone and taken by no one.

### Q-51 → `Gate: device`

Every number in Q-51 came off the S25, run by the owner — Task 3 says so outright — and the entry's
own closing instruction is **"Do the measurement first"** on `/workout` first-mount. **That
measurement cannot be taken here.** Against `pnpm dev` a first mount includes route compilation;
`next start` sets `NODE_ENV=production`, which turns on SSL for the pg pool and cannot reach the
local database. So the next step is an owner capture.

Without the field, Q-51 headed a work list offering a large refactor — splitting the two biggest
files in the app, device-only to verify, with no automated component-test route — that its own text
says not to start until the measurement exists.

### Where that leaves Lane B

`READY` is **2**: LB-47, which needs an owner decision on what `Full` should mean on a session-level
deload, and LB-38, which needs its flake to recur with the dump instrumentation in place. Neither is
a build. Every other item is `KEEP` (shipped, device check owed), `PARKED` behind another lane, or
gated on the owner.

### LB-38's sample, corrected upward

Twelve more full-file runs after the canvas-transfer fix, all green. That takes the post-fix sample
to **1 failure in 19 runs**, not the 1-in-10 the entry first recorded.

**And no dump has been captured yet, for an ordinary reason: the one failure came before the dump was
wired into the every-style loop.** So the offline decode — LB-38's actual open question — is still
unanswered, and the entry now says so plainly with an instruction to keep the file before doing
anything else.

The pre- and post-fix rates also cannot be compared directly, and the entry now says that too. The
old "roughly 1 run in 2 across eleven runs" was counting the every-style **timeout** alongside the
decode failure; those are two different faults, and only one of them is left.
