## 2026-08-24 — The per-role model assignment was inert; the prompts could never have applied it

**Branch:** `claude/model-recommendations-ey670v` · docs-only · fixes #352

#352 gave each standing agent a model and effort level and wrote the pair into the top of each
prompt in `docs/agents/prompts/`. The owner then started fresh agents and **every one came up on the
creation default.** The assignment had no effect and could not have had one.

**Why.** A session's model is fixed when the session is created — `create_session` accepts a `model`,
and no tool changes it afterwards. The line was placed *below* the `---` paste boundary, inside the
block pasted into an already-running session, and addressed to the model. It instructed the one
party incapable of acting on it. The same reasoning that made the 🟢 self-title work (a session
*can* rename itself) does not transfer, and that was not checked.

**The fix, in two voices.** Each prompt now carries the pair twice:

- **Above the paste line**, as an instruction to the owner: *"Before you paste: create the session on
  Sonnet 5 with effort `high`."* This is the half that actually sets the model.
- **Below it**, as the session's first action: call `get_session` with `session_id` omitted, compare
  `session_context.model` and `session_context.effort_level` against the role's, and say so in the
  first message if they differ — never quietly proceed on the wrong model.

The self-check is the half that cannot be forgotten. It fires on every session, and a mismatch
surfaces in the first thing the owner reads rather than never.

**A false confirmation is corrected here too.** On 2026-08-23 this session reported that the #352
assignments had "taken effect without you doing anything", citing BugFix and Orchestrator running on
`claude-sonnet-5`. Those sessions were created 2026-08-20, three days before #352 merged; they were
Sonnet for unrelated reasons. Reading a matching value as evidence that a change worked, when the
value predated the change, is the error — and it delayed finding this bug by a day.

**Verification:** `pnpm check:rules` — `Ran 55 of 55`. Docs-only.

**Not exercised:** no app code. The self-check is documented but has not run on a real agent session
— the next agent started from these prompts is the first test, and unlike last time that claim is
not being treated as confirmed until an agent actually reports its model back.
