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

## Not done

- **Nothing has been run against a device.** Every task on the new baton is unticked, and the
  harness itself is the first item.
- **The `.size` durable fix is still unfiled** — now measured four separate times (LA-122 item 5,
  Tuning's 2c at five of seven PRs, Review's three on #1389, six stale bases on #1408 in one
  evening). The design worth writing up is to stop storing the number: check that a grown doc
  carries a new note in the append-only history instead of matching a stored integer.
- **`OR-126`**, the raw-archive brief, is still owed before Q-29 Task 5 can be answered.
