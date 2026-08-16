# AI Coach — Phase 1: the widget protocol and the apply path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the assistant a way to render interactive UI inside the conversation, and a way to
write to the database that the user drives. This phase builds the spine only — the protocol, two
widgets, and the apply endpoint. Phases 2 and 3 (`…-ai-coach-route-and-thread.md`,
`…-ai-coach-write-domains.md`) build on it and must not start first.

**Tech stack:** TypeScript/React, `ai` v6.0.214, `@ai-sdk/react` v3.0.216, `@ai-sdk/google` v3.0.86,
Drizzle/Postgres. **JS/server only — no `android/**` changes, so this reaches the device through a
Railway deploy with no new APK.**

**Design source:** `docs/design/2026-08-08-ai-coach-conversational-ui.html` (§2 widget vocabulary,
§3 rules) and `docs/design/2026-08-08-ai-coach-round3-widgets.html` (§1 pairing, §2 tiers). Owner
decisions are recorded in those files' §4/§5 — **do not re-open settled questions.**

---

## Why the obvious approach is wrong

The existing chat already embeds structured UI in its output: the model writes a
`<sheet_chart>{…}</sheet_chart>` block into its *text*, and the client extracts it with a Zod schema
(`packages/shared/src/parse-chart-blocks.ts`). The tempting move is to add
`<coach_widget>{…}</coach_widget>` beside it.

**Don't.** That mechanism survives for charts because a malformed chart block is silently dropped
and the user loses a picture. A malformed *input* widget would render an Apply button over a patch
nobody validated, which is the one failure this feature cannot have. CLAUDE.md is explicit: every
LLM call returning structured data uses a response schema, never `JSON.parse` of free text, and no
LLM self-reported value may gate an automatic action.

The right primitive is already installed and unused. **A tool declared without an `execute`
function becomes a client-side tool**: the SDK streams the tool call to the client, validates its
arguments against the tool's Zod schema (the model retries on mismatch), and pauses the conversation
until the client supplies a result via `addToolResult`. That is exactly a widget — typed payload
out, user's answer back in.

### The one thing that looked right and is not

`ai` v6 ships a first-class tool-approval flow (`needsApproval`, `tool-approval-request` parts,
`addToolApprovalResponse`). It reads like a perfect fit for the confirmation step. **It is not**,
and the reason is worth writing down so nobody rediscovers it in code review: `ToolApprovalResponse`
is `{ approvalId, approved: boolean, reason? }` (verified in
`@ai-sdk/provider-utils@4.0.33/dist/index.d.ts`). It is **binary and carries no edited payload**.
The owner has confirmed per-row toggles — you must be able to accept the exercise swap and decline
the percentage change — and a binary approval cannot express that. Routing a toggle through
deny-with-a-reason costs a model round-trip per toggle and makes the outcome non-deterministic.

So: **the model proposes, code applies.** The proposal arrives as client-side tool args, the client
renders it and lets the user edit the selection, and the client POSTs the final patch to an ordinary
Zod-validated route. The model is never in the write path. This also means the apply route is
testable without an LLM, which the write path for someone's training program should be.

---

## Architecture

```
model  ──tool call (no execute)──▶  client renders widget
                                          │
                                    user taps / toggles
                                          │
              ┌───────────────────────────┴─────────────────┐
              │                                             │
      non-write widget                              ChangePreview
      addToolResult(value)                     POST /api/coach/apply
      → conversation continues                 → shared write function
                                               → addToolResult(applied summary)
```

Two rules that fall out of this and must hold everywhere:

1. **A widget's payload is its tool call's arguments.** Nothing structured travels as text.
2. **Every write goes through `/api/coach/apply`.** The chat route never writes. This keeps one
   auditable entry point and matches the repo's one-write-function-per-domain rule.

---

## Task 1 — the widget registry and protocol

- [ ] Create `lib/coach/widgets.ts`. Export a `CoachWidget` discriminated union of Zod schemas, one
      per widget `kind`. This phase defines two: `choice_list` and `change_preview`. Phase 3 adds
      the rest — the union is the extension point.
- [ ] `choice_list` args: `{ prompt: string, options: Array<{ id: string, title: string,
      subtitle?: string, colorKey?: string }>, sourceHint?: string }`. `id` is a real DB id
      (`program_sessions.id`, `session_exercises.id`, …) — never a name. **Session identity is the
      DB id** per CLAUDE.md's no-hardcoded-session-names rule, and the option list is built from the
      user's active program at call time.
- [ ] `change_preview` args: the patch (Task 3) plus `{ title: string, consequences: Array<{ kind:
      'warn' | 'info' | 'good', text: string }> }`. Consequences are *computed server-side and
      supplied to the model*, never invented by it — see Task 4.
- [ ] Create `components/coach/widget-registry.tsx` mapping `kind` → component. An unknown `kind`
      renders a neutral "this needs a newer app version" card, never a crash and never nothing.
- [ ] Cap widgets at **one interactive widget per assistant turn**. Output cards (charts, tables)
      are unlimited and are *not* widgets — they stay in the text stream. Enforce in the system
      prompt and defensively in the renderer: if a turn carries two interactive widgets, render the
      first and drop the rest with a logged warning.

**Verify:** a unit test that every member of the union round-trips through `safeParse`, and that an
unknown `kind` hits the fallback branch rather than throwing.

## Task 2 — client-side tools on the chat route

- [ ] In `lib/ai-chat/tools.ts` (or a new `lib/coach/tools.ts` if that file is near its size limit),
      add `renderChoiceList` and `proposeChange` as tools **with no `execute`**. Their `inputSchema`
      is the matching widget schema from Task 1.
- [ ] The existing fourteen read-only tools are unchanged and keep their `execute`. They are how the
      model learns what to put in a widget.
- [ ] Switch the route's response from `textStreamResponse(result.textStream)` to the UI message
      stream, so tool-call parts reach the client. **This changes the client contract** — the
      hand-rolled `res.body.getReader()` loop in `components/ai-chat-overlay.tsx` decodes raw text
      and will not understand the new protocol. Phase 2 replaces that client; until then, do the
      work behind a **new route** (`app/api/coach/route.ts`) and leave `/api/ai-chat` untouched so
      the shipped overlay keeps working.
- [ ] Rate-limit the new route at creation, matching `ai-chat`'s `rateLimit(\`${userId}:coach\`, 15,
      60_000)`.

**Verify:** `pnpm dev`, POST to `/api/coach` with a prompt that should produce a picker, and confirm
the response stream contains a tool-call part whose args parse against the schema. This is a
protocol check, not a UI check — no rendering needed yet.

## Task 3 — the patch schema

- [ ] Create `lib/coach/patch.ts`. A `CoachPatch` is `{ domain, targetId, changes: PatchChange[] }`
      where each `PatchChange` is `{ field, from, to, id }` — `id` so the client can toggle
      individual rows and the server can apply a subset.
- [ ] This phase implements **one domain: `session_exercise`** (swap an exercise, change
      sets/reps/pct/rest). It is the owner's headline example and it exercises every part of the
      shape. Phase 3 adds the others.
- [ ] `from` is included so the preview can render the diff **and so the server can detect
      staleness**. It is not decorative.

## Task 4 — consequences are computed, not narrated

- [ ] Create `lib/coach/consequences.ts`. Given a `CoachPatch`, return the `consequences` array by
      querying real data: weekly set count per muscle before/after, whether a PR is orphaned, when
      the change first takes effect.
- [ ] Call it **server-side inside the `proposeChange` tool's argument assembly** — the model asks
      for a change, the server computes what it costs, and the widget shows the computed answer.
      A model-authored consequence list is a plausible-sounding guess about someone's training and
      must not exist.
- [ ] Include at least one *positive* consequence where one is true. A list that only warns reads as
      a scare rather than a briefing (design note, D1).

**Verify:** a DB-backed test that swapping a compound lift for an isolation one produces the correct
before/after weekly set counts for the affected muscles.

## Task 5 — `POST /api/coach/apply`

- [ ] New route. Body: `{ patch: CoachPatch, acceptedChangeIds: string[] }`. Zod-validated at the
      boundary — untyped passthrough to the driver is not validation.
- [ ] **Re-validate against current state before writing.** For every accepted change, confirm the
      row still exists, is still owned by this user, and its current value still equals the patch's
      `from`. If any differ, return `409` with the drifted fields and **write nothing**. A proposal
      generated three turns ago must not apply to moved ground — the user may have edited the
      program in another tab, or a completed workout may have regenerated the prescription.
- [ ] Ownership: the client supplies `session_exercises.id`, and that table has no `user_id`. Verify
      ownership by joining to the owning program exactly as `ensureWorkoutSession` does for session
      ids. This is the exact bug class CLAUDE.md flags as having recurred across three domains.
- [ ] Do the write through the **existing shared function** for the domain — the same one
      `/api/workout-review/[sessionId]/apply` and the `pushMutations` branch use. Do not add a third
      write path. If no shared function exists for a field, extract one in this PR rather than
      inlining.
- [ ] Invalidate via a named group in `lib/cache-groups.ts` (`invalidateProgramStructure()` for
      program edits) — never a hand-rolled key list at the call site.
- [ ] Record the applied change: a `coach_changes` row with the patch, the accepted subset, the
      before-state, and `applied_at`. This is what makes Undo and the history list possible, and it
      costs one insert.

**Verify:** run every branch against the local dev DB — clean apply, partial apply with a subset,
409 on drift, 403-equivalent on a row owned by another user, and confirm cache groups fire.

## Task 6 — Undo

- [ ] `POST /api/coach/apply/[id]/undo`. Restores the before-state recorded in Task 5, subject to the
      window: **undo stays live until the next workout session that uses the changed program**
      (owner decision). After that the row remains, readable as history, with undo disabled.
- [ ] Undo is itself a write and goes through the same shared function and cache groups.
- [ ] Re-validate the same way apply does. If the row drifted since, refuse rather than clobber.

**Verify:** apply → undo → confirm the program matches its pre-change state. Then apply → log a
workout on that program → confirm undo is refused with a clear reason, not a silent no-op.

## Task 7 — the two widget components

- [ ] `components/coach/choice-list.tsx`. 56dp rows, title + optional subtitle, optional colour key
      bar for the fused chart pairing (Phase 3 uses it). Caps at **six visible rows then scrolls
      internally** — a twelve-row widget pushes the composer off-screen.
- [ ] `components/coach/change-preview.tsx`. Per-row switches, `from → to` with the old value struck
      through, the computed consequence list, Cancel and Apply. Apply is disabled at zero accepted
      rows and its label carries the count.
- [ ] Real controls: shadcn `<Button>` and the existing `Switch` primitive, proper ARIA. Rows are
      `<div role="button" tabIndex={0}>` where they contain other controls — never nested
      `<button>`, which Samsung's WebView silently strips.
- [ ] Theme tokens only (`--accent-purple` for input widgets, neutral for output). No hex literals,
      no `text-white`.
- [ ] In-flight guard on Apply. Five rapid taps once fired four `complete-workout` POSTs.

**Verify:** at 412×891 in both themes. Tap targets ≥48dp. No horizontal overflow.

## Task 8 — the stale and abandoned states

- [ ] A widget goes **inert the moment a newer turn exists** — dimmed, dashed border, "no longer
      current". It must not silently act when tapped after being scrolled back to.
- [ ] A `409` from apply renders in place as "this suggestion is out of date" with a re-ask action,
      not a generic error toast.

**Verify:** render a thread with an unanswered widget followed by a later turn; confirm the old
widget is non-interactive.

---

## What this phase deliberately does not do

- No `/coach` route or new chat UI — Phase 2. This phase ships behind `/api/coach` with no user-
  facing entry point, which is why it can merge without a device check.
- No widgets beyond the two above, and no write domains beyond `session_exercise` — Phase 3.
- No thread persistence — Phase 2.
- The existing `/api/ai-chat` and `components/ai-chat-overlay.tsx` are **untouched**. Retiring them
  is Phase 2's last task.

## Migration numbers

Claim against both the directory and open PRs before writing. As of 2026-08-08 the backlog records
**next free Postgres migration number: 170**. This phase needs one migration for `coach_changes`.

## Failure surfaces this phase cannot exercise

Sandbox `pnpm dev` cannot reach: Samsung WebView rendering, real safe-area insets, native SQLite, or
drifted production data. None of those are on this phase's path — it ships no UI entry point and
writes through existing shared functions — but the widget components land here and are first *seen*
in Phase 2, so their device check belongs there.
