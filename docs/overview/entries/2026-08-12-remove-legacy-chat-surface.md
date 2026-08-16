# 2026-08-12 — the unreachable chat surface is gone, and text-to-speech with it (Q-189)

**Branch:** `chore/remove-legacy-chat-surface`

## What was deleted

`app/chat/`, `app/sheet/[id]/chat/`, `components/chat.tsx`, and `app/api/ai-chat/` including
`app/api/ai-chat/tts/`. Nothing in the app linked to any of it — every chat entry point goes to
`/coach`, and `app/sheet/[id]/chat/page.tsx` only redirected to the orphaned `/chat`. The Coach
route's own comment said the pair would be deleted once the entry points were repointed; the
repoint happened, the deletion did not.

## The entanglement, and the owner's decision

`components/chat.tsx` was the **only** caller of `/api/ai-chat/tts`, so deleting the surface deletes
text-to-speech from the app. Q-189 said explicitly: decide that first, do not discover it halfway
through.

Owner decision 2026-08-12: **delete both, drop read-aloud.** TTS does not move to Coach. The
reasoning put to them and accepted: read-aloud was reachable only from a screen nothing links to, so
it has already been unusable for some time.

## Consequences worth knowing

**`GEMINI_API_KEY` is now read by no code at all.** It existed solely for the TTS route. CLAUDE.md's
env-var list is struck through accordingly and the variable can be removed from Railway.

That entry originally said the `@google/genai` package went with it — **wrong, and caught by
checking rather than assuming.** `lib/exercise-image-gen.ts` still imports it. It runs on
`GOOGLE_GENERATIVE_AI_API_KEY`, so the key claim holds, but the package stays.

**One of the two sign-out buttons went with it.** Q-172's leak was that More/Profile ran the full
device clear while `components/chat.tsx`'s two sign-out buttons did none of it. Those buttons are
now deleted, leaving exactly one sign-out control. `clear-on-sign-out.test.ts` asserted over both
files and now asserts over the one that remains, with a comment saying why the list shrank.

**This changes the device check I wrote earlier today.** `docs/device-smoke-checklist.md` tells the
owner to test "both sign-out buttons" — after this merges there is only one. Updated in the same PR.

## Dead code this exposed, and the line drawn around it

- **`parseChartBlocks`** (`packages/shared/src/parse-chart-blocks.ts`) had no caller left. Coach
  never used it — its charts arrive as a structured widget, which is the whole reason it is not the
  in-text `<sheet_chart>` pattern (`lib/coach/widgets.ts` says so). Removed, along with its
  re-export from `chart-message.tsx` and its test file. **The Zod schema and `ChartPayload` type
  stay** — `chart-message.tsx` is used by `coach-chart.tsx`, so deleting the module wholesale would
  have broken Coach.
- **`components/chart-error-boundary.tsx`** turned out to have **zero references anywhere** in the
  repo, and was already dead before this change — `chat.tsx` did not use it either. Removed, since
  it sits in the same chart path and its only doc comment referenced the function just deleted. This
  is the one deletion here that is not strictly Q-189's scope; it is called out rather than folded
  in silently.

## Verification, and its limits

`tsc` clean, eslint clean, all 31 Custom Rules steps, suite **456 files / 3,762 tests green**.

**The path checker caught a stale reference I would otherwise have shipped**: CLAUDE.md's
emoji-convention line named `components/chat.tsx` as an example of message-content emoji. Amended.
That check is one of the 31 inline workflow steps, not one of the four `scripts/check-*.js` files —
exactly the gap Q-206 describes, and the reason to run the whole job locally.

**A stale `.next/` cache produced four phantom `tsc` errors** for the deleted route modules
(`Cannot find module '../../app/chat/page.js'`). They come from Next's generated
`.next/types/validator.ts`, not from source. `rm -rf .next` cleared them. Worth knowing before
chasing a type error that does not exist.

## Not exercised

- **Not verified on device.** Nothing here changes a screen the owner can reach, since the deleted
  routes were unreachable — but the sign-out button count changed, and sign-out is exactly the flow
  Q-172 is waiting to have device-verified.
- **`pnpm dev` was not used to confirm the deleted routes 404**, because there is nothing to
  confirm: no link, redirect, or fetch targets them any more, which the grep above establishes more
  completely than clicking would.
- **Whether the owner ever used read-aloud is inferred, not measured.** The argument is structural —
  it was reachable only from an unreachable screen — not a usage query.
