# 2026-09-22 — `chore/or-128-device-agent-coordination` (OR-128)

**Orchestrator.** The owner stood up a local agent with device access and asked for it to be made a
standing role, coordinated with rather than run ad hoc. This registers it as the **seventh** agent
and splits the work between it and the Orchestrator.

## The role

📱 **Device Verification** runs on the owner's Windows machine with the S25 plugged in over USB. It
is the only role on this repo that does not run in a container, and therefore the only one that can
see the real app in the real APK.

It exists because the device-verification gate had no owner. **104 checks are owed** and they
accumulate faster than the owner clears them by hand, because each costs his attention rather than
CI time. Three classes are reachable nowhere else — offline-first reads (`getLocalStore` returns
null off the APK), safe-area clearance (the insets are `0` in desktop Chromium), and what Samsung's
WebView actually paints — plus the Android system back, which arrives over a Capacitor channel
Playwright cannot fire at all.

**It verifies and reports; it does not implement.** One exception: `scripts/device/**` is its own,
because that harness shipped unrun and whoever first points it at a phone is the only session that
can fix it.

**Three outcomes, never a fourth:** VERIFIED ON THE S25 · FAILED ON THE S25 (which is *work for a
lane*, not verification debt) · COULD NOT CHECK, with the reason. And a result that does not name
its screen, orientation and navigation mode is not a result — three-button navigation alone reports
every safe-area inset as `0`, which makes a broken clearance look correct.

## What landed

- `docs/agents/state/device.md` — the baton, **seeded with a prioritised task list** rather than
  left empty, because the role starts on a harness nobody has run.
- `docs/agents/prompts/device.md` — the standing prompt. It opens by telling a session created in a
  container that it cannot do this job and should say so and stop: *a device agent that cannot see
  a device is worse than none, because its answers look like the real thing.*
- `docs/agents/README.md` — §1 role description, the `DV-` letter, and the roster row.
- `CLAUDE.md` — six roles to seven, the title list, and one new rule: the three outcomes.
- `docs/agents/state/orchestrator.md` — rewritten for the split.

## The split, which is the point

**It observes, the Orchestrator reconciles.** It writes outcomes into the entries and its baton; the
Orchestrator reads them, strikes what is settled, re-files what failed, and routes it to a lane.
Neither duplicates the other: the Orchestrator cannot see a phone, and the device agent does not
own the queue.

Its captures reach the other agents through git — a throwaway `device-captures/<date>` branch, read
then deleted, never merged. **The per-screen digest matters more than the images**, because a
remote reviewer pays for every image and reads text for free.

## The ratchet caught the baton, and cutting was the right answer

The Orchestrator baton went to 95 lines on the first pass, 34 over its baseline. Rather than raise
the number to fit, it was cut twice — narrative compressed out of "Now", four gotchas merged into
two — landing at 81. The growth that remains is genuinely new state: a seventh agent to coordinate
with, and a task list that until today lived only in a chat transcript.

**Worth carrying: a baton is state, not a story.** The contract already says rewrite it in full and
never append. The size ratchet is what makes that enforceable, because appending is invisible until
something counts. On a baton, the right response to that check is almost always to cut.

## The flow between agents, which is what the owner actually asked for

The first pass hand-wrote a task list into the device agent's baton. That was wrong, and the owner
named the right model: **tasks go in the queue, in a lane; the agent reads its lane and works it
off.** Exactly how implementers already work.

**`Lane:` is now the whole channel.** `DV` joins `A`, `B` and `O` as a value, so any agent hands
work to any other by writing a field — Review finds something only the phone can settle and writes
`Lane: DV`; the device agent finds a real defect and writes `Lane: B`; anyone hits a question
needing the owner and writes `Lane: O`. No message, no handoff doc, no two sessions awake at once.
**The queue is the channel, and an entry outlives the session that wrote it.**

**`O` and `DV` are strict where `A` and `B` are not.** An unstated lane means *"§3's path rule
answers it"*, and that rule only ever resolves to an implementer — so untagged work showing in both
implementer lanes is the safe failure it was designed as, and the same 400 entries shown to the
Orchestrator or the device agent would bury the dozen genuinely theirs.

**A device check is not a lane assignment**, and keeping those separate is the part most likely to
be got wrong later. A shipped entry owing a look keeps its own lane and carries `Verify: device` or
a `Keep:`; `--sittings` gathers those across the queue by screen, now **ordered by queue position**
so moving one entry up promotes a whole sitting. `Lane: DV` is for what the device agent
*delivers*. Merging the two would put a hundred entries in one lane and tell it nothing about order.

**Cadence**: each session arms a recurring wake-up and re-reads its own lane — hourly for the
implementers and the Orchestrator, on demand for Device Verification, which needs the phone and the
owner present. **A quiet wake-up is silent**: re-arm and say nothing, because an agent that reports
"nothing to do" every hour trains everyone to stop reading it.

`DV-1`, `DV-2` and `DV-3` are filed as the first entries in that lane — make the harness connect,
the back-gesture sitting, three cheap blockers — with `DV-2` and `DV-3` correctly parked behind
`DV-1`.

## The same bug, predicted by its own file, twice

`scripts/lib/entry-id.js` opens with the story of `OR-` being added as a role without its letter
reaching the shared prefix list, and the failure being *"silent deletion, not a wrong label"*.

**That happened again, to `DV-`, on the day the role was created.** Three entries were written; the
queue total read **identically with and without them**, and `--lane DV` printed *"nothing
startable"* while the headings sat in the file. The role's own PR had already taught `lib/lane.js`
the new value — **so the lane parsed and the id did not**, which is the worst shape available:
every individual piece looked correct.

The letter is in `entry-id.js` now, the test that pins the set knows it, and both carry the second
instance in their comments. **Adding a role means adding its letter there, in the same PR as the
role.**

## Not done

- **Nothing has been run against a device.** Every task on the new baton is unticked, and the
  harness itself is the first item.
- **The `.size` durable fix is still unfiled** — now measured four separate times (LA-122 item 5,
  Tuning's 2c at five of seven PRs, Review's three on #1389, six stale bases on #1408 in one
  evening). The design worth writing up is to stop storing the number: check that a grown doc
  carries a new note in the append-only history instead of matching a stored integer.
- **`OR-126`**, the raw-archive brief, is still owed before Q-29 Task 5 can be answered.
