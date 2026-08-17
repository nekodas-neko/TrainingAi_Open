## 2026-08-17 — the standing-agent model, and the documentation cleanup it needed first

**Branch:** `claude/docs-review-agent-setup-3ocl7m` · **Domain:** `platform` · Docs + two CI checks,
no application code.

Owner asked for two housekeeping passes — a review and reorganisation of the documentation, and a
sweep of open tasks — plus a written operating model for four agents intended to run continuously:
two Implementation lanes working the backlog in parallel, a BugFix agent for owner reports, a Tuning
agent for score calibration, and a weekly Review agent.

### What shipped

**The operating model** is [`docs/agents/README.md`](../../agents/README.md), with cold-start
prompts in `docs/agents/prompts/` and per-agent batons in `docs/agents/state/`. Three properties do
most of the work:

- **Only the Implementation lanes write code.** BugFix, Tuning and Review all end at a docs-only PR.
  That reduces the collision surface between five concurrent agents to Lane A against Lane B.
- **The lane seam is file ownership, not subject** — Lane A owns what decides what is true (data,
  sync, scoring, server routes, device pipelines), Lane B owns what decides how it looks. `lib/` is
  too mixed to enumerate without going stale, so unlisted paths are claimed in a baton under a
  stated tie-break rather than listed exhaustively.
- **Q numbers come from per-agent bands**, not a shared next-free pointer. That pointer is a floor
  that cannot see an unmerged PR, which is how six collisions happened in three days.

Tuning is deliberately propose-only: the owner signs off and Lane A implements. A proposal is
incomplete until it states how many *other* days a change moves — the check that separates a
calibration from a silent rewrite of months of history.

### What the cleanup found

The reorganisation was not cosmetic. Every one of these was already forbidden in prose:

| | Before | After |
|---|---|---|
| `projectOverview.md` | 9,647 lines, opening with "lean index" | 6,319 |
| — its Current Status | 3,361 lines, 157 dated notes, no date order | 26 lines |
| — its version claim | v1.303.3 against a `package.json` of v1.317.3 | correct |
| `docs/implementation-backlog.md` header | 397 lines, 268 of them one nested "Previously N" chain | 48 |
| — migration pointer | 177, directory head 188 | 189, checked |
| — SQLite pointer | v22, `migrations.ts` at v26 | v26, checked |
| `docs/overview/entries/` | 509 loose files against a 20-file threshold | 11 |
| `agents.md` | a drifted copy of `CLAUDE.md`, contradicting it in three places | a pointer |

**Q-306 and Q-307 were each held by two different entries.** The review of 2026-08-16 claimed both
for scoring findings; the public-repo-cut session claimed them again the same day. Renumbered the
second pair to Q-311/Q-312 and updated the five live references, leaving dated journal and review
entries alone since they record what was true when written.

**Ten more duplicates surfaced only once a check looked.** Each was a `✅ FIXED` marker heading left
sitting above the original entry — which the backlog's own protocol forbids, since a completed item
must be *removed*, not narrated. All ten name a shipped version at or below v1.297 against a current
v1.317, so they are struck. **Q-107 and Q-270 stay**: one records a fault that stopped on its own
rather than one that was fixed, which `CLAUDE.md` is explicit is not the same thing, and the other
is only fixed forward.

### What was deliberately not done

**The Known Issues section is untouched**, and it is now the bulk of `projectOverview.md` at 6,120
lines across 256 entries. 25 of those are marked resolved, but **22 still owe something real** —
mostly device verification, plus an owner action on the Oura BLE re-sync and a queued implementation
for Q-308. Archiving by pattern would have buried live work for the sake of three clean entries. The
82 rows waiting on device verification are the actual bulk driver, and Q-254 already owns them.

`Q-170` also stays, as an explicit retention with a stated reason, though it is the same
shipped-narrative shape as the ten that were struck.

### The checks, and the regression they caught

Prose asking for restraint loses to the fact that appending is always the locally cheapest move, so
both problems are checks now, in the shrink-only shape the repo already uses for hex literals and
component size. `scripts/check-backlog-pointers.js` reads the migrations directory and
`migrations.ts` rather than trusting the file, and rejects duplicate Q numbers and untagged
headings. `scripts/check-doc-index-size.js` ratchets the three orientation files and guards the
journal directory — its limit is 60 rather than the documented chore threshold of 20, because
failing at 20 would block unrelated PRs for a tidiness task while 509 is the number that did damage.

**Both were mutation-tested.** Each of the six failure conditions was shown to fail on a broken
input before any passing run was believed — which is what caught the ten hidden duplicates in the
first place, since the original hand-written grep required `Q-` immediately after the domain tag and
those headings carry a `✅` in between.

The compaction itself broke 439 links: 324 pointing into `entries/`, 97 relative paths inside
content that moved up a directory, and 18 sibling references between entries. All repaired, plus 286
link *texts* that still named files that no longer existed. `pnpm check:rules` runs **38 of 38**
clean.

### Not exercised

No application code changed, so there is nothing to device-verify. `npx tsc --noEmit` is clean and
`pnpm lint` reports 0 errors against 122 pre-existing warnings. The full test suite and `pnpm build`
were not run in-session — CI covers both, and this branch touches no file either of them compiles.
The agent model itself is **unproven**: no session has yet run from one of the prompts, and the lane
contract's tie-break for unlisted paths has never been exercised under real contention.
