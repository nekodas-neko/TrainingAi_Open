## 2026-08-23 — The handoff session marker moves to the front of the title

**Branch:** `claude/model-recommendations-ey670v` · docs-only · follows #352

#352 landed the `(old)` self-rename at handoff as a **suffix**. The owner asked for it at the front
instead, and the reason holds up: session lists truncate from the right and are read down the left
edge, so a marker at the end of the title is the first thing lost to truncation and the last thing
the eye reaches. At the front it survives truncation and groups the dead sessions together.

So the convention is now `(Old) Implementation Agent (A) 🚧`, not `Implementation Agent (A) 🚧 (old)`.
Capitalised, one space, prefix only. Updated in `docs/agents/README.md` §4 (subsection heading, body,
and step 6 of the handoff ritual) and in the closing paragraph of all six `docs/agents/prompts/*.md`.
Each prompt now also states *why* it is a prefix, so the next person to touch it does not quietly
move it back.

The mechanism is unchanged and still verified: `get_session` with `session_id` omitted returns the
calling session's own ID in `ccr.id`, then `set_session_title` with that ID. Exercised again on this
session while making the change.

The #352 journal entry still describes the suffix form. It is left as written — journal entries are
history and are not edited after the fact; this entry is the correction.

**Verification:** `pnpm check:rules`. Docs-only, no version or changelog bump. Nothing here is in
`docs/doc-size-baseline.json`.

**Not exercised:** no app code, so no runtime, device or CI-behaviour surface.
