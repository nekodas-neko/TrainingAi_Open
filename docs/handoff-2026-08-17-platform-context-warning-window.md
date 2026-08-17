# Handoff — 2026-08-17 · Context-usage warning fired at 22% of the real window

_Domain: `platform` · Branch: `claude/claude-md-rules-context-uc2xpb` · PR: #19 (open at time of writing)_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/platform/README.md`](domains/platform/README.md). This file covers only what *this*
> session did.

## Goal

The owner reported that the wrap-up warning ("Session context at ~111%… wrap up soon") kept firing
while the context window still had most of its room. Find why, and stop it nagging.

## What shipped

| Change | Where |
|---|---|
| Default context window raised 200k → 1M, so the 90/95% thresholds land at 900k/950k | `.claude/hooks/context-usage-warn.mjs:14` |

That is the entire code change — one constant plus a comment recording why. PR #19.

**The diagnosis is the useful part.** The warning is **not** a CLAUDE.md rule, which is where the
owner (reasonably) went looking for it. It is a `Stop` hook, `.claude/hooks/context-usage-warn.mjs`,
registered in `.claude/settings.json`. It sums `input_tokens + cache_creation_input_tokens +
cache_read_input_tokens` from the latest assistant turn in the transcript and divides by a window
constant. That constant was hardcoded `200_000` while sessions actually run on **1M**, so a genuinely
comfortable 222k-token session was reported as **~111% full** and pushed toward a handoff with ~78%
of the window free. The percentage was wrong by 5×, in the alarming direction, on every session.

## Verification

Piped synthetic transcripts through the hook directly:

| tokens | result |
|---|---|
| 222k | silent |
| 899k | fires at ~90% |
| 950k | fires at ~95% |

**Not exercised:** the hook's real invocation path — it was run by hand with a crafted stdin
payload, never observed firing from an actual `Stop` event at 900k, because reaching 900k to prove
it is not practical. The threshold arithmetic is verified; the wiring is unchanged from a version
that demonstrably fired, which is the basis for believing it still does.

Nothing here touches app code, so no `pnpm dev` pass, no device check, and no changelog entry —
`.claude/` tooling is not user-visible product surface.

## Key decisions (with rationale)

- **Fixed the denominator instead of deleting the hook.** The owner's opening suggestion was to get
  rid of the rule. The warning has real value — it is the thing that prompts a handoff before
  auto-compaction drops context — and it was firing wrongly only because it measured against the
  wrong number. Deleting it would have traded a false-alarm problem for a silent-cliff problem. The
  owner then asked to "move the limit up to 900k", which settled it.
- **Changed the default rather than setting `CONTEXT_WINDOW_TOKENS` in `settings.json`.** The hook
  already read that env var as an override. Putting 1M in `settings.json` would have left a wrong
  default in the file for anyone who ran the hook outside this repo's settings; changing the default
  makes the correct value the one you get for free. The override still works for tightening it.

## Gotchas

- **The transcript carries no context-window size.** Checked: entries hold `message.model`
  (`claude-opus-5`) and full `usage`, but nothing naming the window. So the hook cannot self-calibrate
  from its input — a hardcoded constant or the env var is the only option available to it. If the
  session window ever changes again, this constant is the thing that goes stale, and it will go stale
  silently, in whichever direction is wrong.
- The rendered message says `1000k` rather than `1M` — the `k()` helper only knows thousands.
  Cosmetic, left alone deliberately.

## Deliberately NOT done

- No change to the `90`/`95` thresholds themselves, or to the once-per-threshold `/tmp` marker logic.
- No `1M` formatting fix in `k()`.
- No CLAUDE.md edit. Nothing in CLAUDE.md was wrong; the confusion was about *where the rule lived*,
  and this handoff plus the hook's own comment is the record of that.

## Files to look at

- `.claude/hooks/context-usage-warn.mjs` — the hook. The window constant is line 14.
- `.claude/settings.json` — where it is registered as a `Stop` hook.

## Open questions

None. Nothing is waiting on the owner.

## Pickup prompt

```
This is a fresh session on the TrainingAi_Open repo. The previous session was a one-line platform
fix and is fully closed — PR #19 raised the context-usage warning window from 200k to 1M in
.claude/hooks/context-usage-warn.mjs, so the wrap-up nag now fires at 900k/950k instead of 180k.
Nothing is outstanding from it; do not re-open that work.

Start by working out which standing agent you are: read docs/agents/README.md, then your baton at
docs/agents/state/<agent>.md. If you are Implementation Lane B, your baton names Q-309 (a touch tap
on Nutrition's action row not activating the button while a synthesised click does) as the next item.

Orientation reads, in order: projectOverview.md (status + Known Issues), then
docs/domains/<pillar>/README.md for whichever pillar your item sits in, then
docs/implementation-backlog.md for the queue. Also read error_events in production per the
CLAUDE.md session-start rule.

Constraints that will otherwise be re-discovered: everything reaches main through a PR with green
CI (Lint, Tests, Build, Custom Rules, Migration Check) — direct pushes are blocked. Run
`pnpm check:rules` for the custom-rules gate and quote the "Ran N of N" count rather than the word
"pass". Anything touching offline-first domains, native plugins, safe-area, gestures or
notifications needs an on-device smoke run or a Known-Issues row marking it not-yet-device-verified.
Take Q numbers from your agent's band, never from the next-free pointer.
```
