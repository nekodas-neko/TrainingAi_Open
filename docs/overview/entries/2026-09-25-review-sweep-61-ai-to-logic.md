# 2026-09-25 — Review sweep 61: where AI can be replaced with logic

**Branch:** `review/sweep-61-ai-to-logic` · **Agent:** Review · **Docs only.**

- **Owner request:** use logic instead of AI where possible, for tokens and offline use.
- **Usage:** 121 AI calls and about 235k tokens in 30 days. That is cents, so the case for this
  work is offline use, latency and correctness.
- **Five entries:**
  - **RV-200:** replace four AI rewordings of computed facts: daily-digest, session-explain,
    running-plan explain and the goals prose.
  - **RV-201:** logic-first health-insight and weekly-digest, with the week page working offline.
  - **RV-202:** a deterministic prescription fallback instead of a ~30 s failure, and a duration
    change without a model call.
  - **RV-203:** food capture checks the user's own foods before asking the model, and meal plans
    use the library by default.
  - **RV-204:** workout-review and recap from existing code.
- **Kept on the model:** Coach, builder-chat, photo and recipe scans, new meals, and naming a new
  exercise.
- **PS-31** gained a note: RV-201 and RV-200 supersede its items (a) to (c).

Write-up: `docs/reviews/2026-09-25-sweep-61-ai-to-logic.md`. Read from code and `ai_call_log` only.
