## 2026-08-23 — Per-role model assignments and the `(old)` self-rename at handoff

**Branch:** `claude/model-recommendations-ey670v` · docs-only

The owner had been running all six standing sessions on Opus 5 and asked whether that was overkill.
It mostly is not — the Opus/Sonnet gap is roughly 1.7× on list price, not the 5× the older instinct
assumes, and with six sessions able to run concurrently the binding constraint is the shared rate
limit rather than money. Two roles move down; the other four stay.

**What landed:**

- `docs/agents/README.md` — a `Model` column on the role table, and a new
  *Which model, and at what effort* subsection under §6 giving the reasoning per role. Lane A and
  Review stay on Opus 5 at `xhigh`, Lane B and Tuning on Opus 5 at `high`, BugFix moves to Sonnet 5
  at `high`, Orchestrator to Sonnet 5 at `medium`.
- The same pair is restated at the top of each of the six files in `docs/agents/prompts/`, so a
  pasted prompt stays self-contained.
- A note that **Haiku 4.5 is structurally unusable for a standing role here** — its 200K context is
  largely consumed by the cold-start orientation read every prompt mandates. It belongs in `Explore`
  subagents instead, which Review and BugFix are now told to use for fan-out searching.

**The `(old)` rename.** Fixed session titles are what let the owner tell six sessions apart, but at
the moment of handover two sessions carry the same name and nothing distinguishes the live one. The
outgoing session now renames *itself* as its final act, appending ` (old)`. Documented in §4 as its
own subsection, added as step 6 of the handoff ritual, and appended to all six prompts.

The mechanism was **verified from inside a live session before it was written down**, including the
round trip back: `get_session` with `session_id` omitted describes the calling session and returns
its own ID in `ccr.id`; `set_session_title` with that ID then changes the title. Both are on the
`claude-code-remote` MCP server.

**Verification:** `pnpm check:rules` — `Ran 54 of 54`, all passed. Docs-only, so no version or
changelog bump. Nothing in `docs/doc-size-baseline.json` covers `docs/agents/README.md` or the
prompts, so the growth does not hit the shrink-only ratchet; the baselined `state/` batons are
untouched.

**Not exercised:** no app code changed, so no runtime, device or CI-behaviour surface is involved.
The per-role assignments are a judgement about model fit, not a measured result — nothing here has
been A/B'd against session outcomes, and the split should be revisited if a downgraded role starts
producing thinner work.
