# 2026-09-23 — `chore/or-131-drop-handoff-nag` (OR-131)

**Orchestrator, Lane O.** The `Stop` hook that warned about context usage is gone, on the owner's
call: *"I don't think we need the handoff hook anymore; this is deprecated."*

## It contradicted the rule it was built to serve

`.claude/hooks/context-usage-warn.mjs` fired at each context threshold with:

> *Wrap up soon: invoke the handoff skill to write `docs/handoff-<date>-<title>.md` (commit + push
> it), then start a fresh session and read that doc first.*

CLAUDE.md now says the opposite, in the session-start rule: **a standing agent is meant to run as
one continuous session per role** — *"rely on Claude Code's automatic context compaction rather than
writing a handoff and spawning a successor just because context is getting long; that keeps cached
tokens working for you instead of resetting them."* Handing off is the exception now — an owner
reset, or a session lost outside anyone's control — not the routine end of a generation.

So the hook was instructing every long-running session to do the thing the contract tells it not to.
A warning that fires correctly and recommends the wrong action is worse than none: it is credible.

## What it was reporting, which is its own small lesson

The message read **"~231% (461k/200k tokens)"**. The hook's own default window is **1,000,000** —
raised from 200k on 2026-08-17 precisely because the smaller number *"reported ~111% at 222k tokens
(22% of the real window) and fired the wrap-up warning while there was still most of a session
left."* Nothing in this repo sets `CONTEXT_WINDOW_TOKENS`, so the 200k came from outside it.

**The hook could not see the number it was dividing by.** A monitor whose denominator is supplied by
an environment it cannot inspect will eventually report a confident percentage of the wrong thing —
and this one did, twice, in opposite directions.

## Removed

- `.claude/hooks/context-usage-warn.mjs`
- the `Stop` entry in `.claude/settings.json` (the `SessionStart` hook that provisions the local
  Postgres is untouched and still the only one)

## On a compaction hook — it would not do anything

The owner asked whether a hook could instead compact the conversation to save tokens while it is
cached. **A `Stop` hook cannot**: it receives the transcript path on stdin and can print, and
nothing more — it cannot invoke `/compact` or any other slash command, which are the CLI's own.

More to the point, **the thing it would trigger already happens.** Automatic compaction is a harness
behaviour and is exactly what the session-start rule tells a standing agent to rely on. A hook here
would be a second mechanism racing the first.

## Not done

Nothing is left behind for a successor to find. The two historical docs that mention the hook
(`docs/handoff-2026-08-17-platform-context-warning-window.md` and the 2026-08-15 history) are
records of when it was tuned and stay as they are — an archive that describes a thing that existed
is not stale.
