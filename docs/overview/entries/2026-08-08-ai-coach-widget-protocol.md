# 2026-08-08 — AI Coach Phase 1: the widget protocol and the apply path

**Branch:** `claude/health-metrics-button-designs-hy6cyv` · **Q-157 phase 1 of 3** · **No version bump** —
this phase ships no user-facing entry point.

## What shipped

The assistant can now render interactive UI inside a conversation, and there is a write path the
user drives. Nothing is wired to a screen yet — that is Phase 2.

- **`lib/coach/widgets.ts`** — a closed `CoachWidget` union (`choice_list`, `change_preview`) used as
  the **input schemas of client-side tools**. A tool declared without `execute` makes the SDK
  validate the model's arguments, retry the model on a mismatch, stream the call to the client and
  suspend the turn until `addToolResult`. That is the widget mechanism.
- **`lib/coach/patch.ts`** — `CoachPatch`, one domain (`session_exercise`). Each change carries its
  own `id` (so rows can be toggled) and its `from` (so drift is detectable).
- **`lib/coach/consequences.ts`** + `/api/coach/preview` — what a change costs, measured.
- **`lib/coach/apply.ts`** + `/api/coach/apply` and `…/[id]/undo` — the only place Coach writes.
- **`components/coach/`** — `ChoiceList`, `ChangePreview`, and a registry that validates at the
  render boundary and falls back to a neutral card.
- **Migrations 170** (`coach_changes`) and **171** (regenerated `claude_ro` views).

## Decisions worth not re-litigating

- **The model proposes, code applies.** The client POSTs the final patch to a Zod-validated route;
  the model is never in the write path. Forced by a real constraint, not taste: `ai` v6's
  tool-approval flow (`needsApproval`) looks like an exact fit, but `ToolApprovalResponse` is
  `{ approvalId, approved, reason? }` — binary, no edited payload — and the owner confirmed per-row
  toggles. Verified in `@ai-sdk/provider-utils@4.0.33`.
- **Not the `<sheet_chart>` in-text block pattern.** It survives for charts because a malformed
  block silently disappears. A malformed *input* widget would put an Apply button over an
  unvalidated payload.
- **Consequences have no field in the schema.** The model cannot author one even if instructed to.
- **`session_exercises` has no sets/reps/pct/rest columns** — the Phase 1 plan said this domain
  covered them and was wrong about the schema. Those live in the progression style or the
  prescription overlay. `patch.ts` documents it; Phase 3 inherits the correction.
- **Coverage delta, not a set-count delta.** The mockups showed "lower-back sets 11 → 4". That needs
  a canonical *planned*-sets helper; the repo has two divergent counters for *logged* sets and
  neither answers it. Adding a third would be the "one formula, one place" violation the rule
  exists to stop, so this ships the exact muscle-coverage delta instead.

## Three things the verification caught that review would not have

1. **`z.literal(false)` breaks Gemini tool declarations.** A Zod literal compiles to a single-value
   enum and Gemini's function-declaration schema accepts only **string** enums. It failed as a
   *masked* mid-stream error part, not an HTTP error — the route returned 200 and the chat simply
   stopped. Fixed by using plain booleans and enforcing the constraint in `applyCoachPatch`; the
   route now logs stream errors server-side, which is how it was diagnosed at all.
2. **The model invented database ids.** Asked "I want to change my workout", it produced a
   well-formed ChoiceList whose ids were `push-123`, `pull-456`, `legs-789`. The route gave it no
   program data, so it had nothing real to list. The apply path refuses an unknown target, so
   nothing unsafe could follow — but every option was a dead end. Fixed by adding
   `getProgramStructure`; a prompt instruction not to invent ids is necessary and not sufficient.
3. **The schema-retry loop is load-bearing.** On the first proposal the model produced
   `{field:"name",newValue:…}`, then a change missing `id` and `from`. Both were rejected and it
   converged on the third attempt. Under the in-text block pattern, attempt 1 would have rendered.
   A worked example in the tool description took it to zero retries over two runs.

## A test-interference bug, measured rather than guessed

The new DB test made `cable-exercise-merge-migration.test.ts` fail under the full parallel suite —
on a **different assertion each run**, and never in isolation or in a pair. Nothing in migration 164
can see this test's data (it is name-scoped to cable exercises), so it was lock/visibility
contention: the fixture did `DELETE FROM programs` per test, which cascades into
`session_exercises`, which that migration also writes.

Confirmed by running the full suite three ways — with the file, without it, and alone. Fixed by
building the fixture once and resetting by primary key. Full suite: **417 files, 3300 tests, green.**

## Verification

| Check | Result |
|---|---|
| Full suite | 417 files / 3300 tests green |
| `pnpm build` | compiles; all four `/api/coach*` routes emitted |
| Lint + all 8 custom-rules scripts | pass |
| Live route, signed in | `renderChoiceList` with **real** session UUIDs; specific ask skips to `proposeChange` |
| HTTP preview → apply → undo | 200 / 200 / 200, DB verified before and after |
| Re-apply a spent patch | 409 with drift detail, nothing written |
| Unknown field / unauthenticated | 400 / 401 |

**Not verified:** no UI is reachable, so nothing was exercised on device — no safe-area, no Samsung
WebView, no native SQLite. The widget components land here but are first *seen* in Phase 2, which
carries their device gate.

## Left open

- Phases 2 and 3 as planned. `/api/ai-chat` and the overlay are untouched and still the live path.
- `pnpm install --frozen-lockfile` was needed locally: `@capacitor-community/speech-recognition` is
  declared in `package.json` but was absent from this sandbox's `node_modules`, which fails
  `pnpm build` on an unrelated file. No lockfile change.
