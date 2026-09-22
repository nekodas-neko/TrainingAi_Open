# 2026-09-23 — `chore/or-129-lane-channel` (OR-129)

**Orchestrator.** The owner asked for a working system where agents feed off each other's updates,
described precisely: *"Tasks are assigned to an agent's backlog… the agent reads whatever is in its
lane and works off it… Review agent or other agents can assign tasks to device verification agent."*

That is what implementers already do. What was missing was making the lane field able to express it.

## `Lane:` becomes the channel

`DV` joins `A`, `B` and `O` as a value, so **any agent hands work to any other by writing a field**.
Review finds something only the phone can settle → `Lane: DV`. The device agent finds a real defect
→ `Lane: B`. Anyone hits a question needing the owner → `Lane: O`. No message, no handoff doc, no
two sessions awake at once. **The queue is the channel, and an entry outlives the session that
wrote it.**

**`O` and `DV` are strict where `A` and `B` are not.** An unstated lane means *"§3's path rule
answers it"*, and that rule only ever resolves to an implementer — so untagged work showing in both
implementer lanes is the safe failure it was designed as, and the same 400 entries shown to the
Orchestrator or the device agent would bury the few genuinely theirs.

**The letter and the lane are different things**, and `DV-1` is the example that makes it concrete:
found by the device agent, carries `Lane: O`, because the work is the Orchestrator's. The letter
records who found it and never changes; the lane records who builds it.

**A device check is not a lane assignment**, and keeping them apart is the part most likely to be
got wrong later. A shipped entry owing a look keeps its own lane and carries `Verify: device` or a
`Keep:`; `--sittings` gathers those by screen and now orders groups by **queue position**, so
moving one entry up promotes a whole sitting. Merging the two would put a hundred entries in one
lane and tell it nothing about order.

**Cadence** is documented per role: hourly for the implementers and the Orchestrator, on demand for
Device Verification (it needs the phone and the owner present; a timer would fire into an empty
room). **A quiet wake-up is silent** — an agent reporting "nothing to do" every hour trains everyone
to stop reading it.

## Most of this session's other PR was already on `main`

`#1417` landed while this was being written, carrying the harness from `#1411` **plus a real device
sitting**. So a first draft of the standing-role registration was duplicated work and was dropped
rather than merged: `main`'s baton is `docs/agents/state/device-verification.md`, not the
`device.md` written here, and `DV-1` was already taken by a genuine finding (`pnpm ci:local` cannot
pass on Windows, which is where that role always runs).

What survived the reconciliation is what `main` did **not** have: the `Lane: DV` value, the strict
lanes, the `--sittings` ordering, the two README sections, and CLAUDE.md's seven-agent update.
Three planned `DV-` entries were **not** filed — the back-gesture sitting they described had already
run.

## Worth carrying

**The same prefix bug fired twice in one day, and its own file had predicted it.**
`scripts/lib/entry-id.js` opens with the story of `OR-` being added as a role whose letter never
reached the shared list, failing as *"silent deletion, not a wrong label"*. `DV-` did exactly that:
three entries written, the queue total identical with and without them, `--lane DV` printing
*"nothing startable"* while the headings sat in the file. The lane parsed and the id did not — every
piece correct on its own. CLAUDE.md now says outright that a new role's letter goes in that file in
the same PR as the role.

**And the reconciliation itself is the argument for the lane channel.** Two sessions built
overlapping answers to the same request because neither could see the other's unmerged work. A lane
entry is visible the moment it merges, to every session that reads the queue afterwards — which is
the failure mode this PR exists to reduce.

## Not done

- **Gesture navigation is still off on the phone**, which invalidates every safe-area check — the
  single owner action unblocking the largest group of owed checks.
- **`DV-1`** (Windows `ci:local`) is `Lane: O` and unstarted; it blocks the device agent's local
  gate, leaving CI as its only one.
- **The `e2e`-on-device decision is open** — `connectOverCDP` attaches, but the specs write into
  the production account.
