# 2026-08-17 — The wrap-up warning was measuring against a 200k window on a 1M session

**Branch:** `claude/claude-md-rules-context-uc2xpb` · **Version:** unchanged · **Lane:** platform / tooling

## What this was

The owner reported the "Session context at ~111% — wrap up soon" warning firing while the window was
nowhere near full, and suggested getting rid of the rule. The screenshot showed the tell in the same
frame: the warning claimed 222k/200k tokens, and the context meter beside it read **222k / 1M (22%)**.

The warning is not a CLAUDE.md rule, which is where it was being looked for. It is a `Stop` hook —
`.claude/hooks/context-usage-warn.mjs`, registered in `.claude/settings.json` — that sums the latest
assistant turn's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` and divides by
a hardcoded window. The window was `200_000`. Sessions run on 1M. So every reading was inflated 5×
and the wrap-up nag fired at roughly 180k, with ~82% of the window still free.

## What shipped

One constant, `.claude/hooks/context-usage-warn.mjs:14` — the default window is now `1_000_000`, so
the existing 90/95% thresholds land at **900k and 950k**. The `CONTEXT_WINDOW_TOKENS` env override
still works for tightening it. PR #20.

Changing the default rather than setting the env var in `settings.json` keeps the correct value as
the one you get for free, instead of leaving a wrong default in the file behind an override.

## Verification

Synthetic transcripts piped through the hook: 222k silent, 899k fires at ~90%, 950k fires at ~95%.

**Not exercised:** the hook running from a real `Stop` event at 900k — reaching that to prove it is
not practical, so the threshold arithmetic is what was verified, not the wiring. The wiring is
unchanged. No `pnpm dev`, no device check, no changelog bump: `.claude/` tooling is not product
surface.

## Worth knowing

The transcript records `message.model` and full `usage` but **nothing naming the context-window
size**, so the hook cannot self-calibrate — a constant or the env var is all it has. This value will
go stale silently if the window changes again.

Handoff: [`docs/handoff-2026-08-17-platform-context-warning-window.md`](../../handoff-2026-08-17-platform-context-warning-window.md).
