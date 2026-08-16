# AI Coach — Phase 2: the route, the thread, and history

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Phase 1's protocol into something the owner can use. A full-page `/coach` route
replacing the 78vh sheet, a thread that renders widgets and collapses them once answered, persisted
history, and the model/grounding change.

**Depends on:** `2026-08-08-ai-coach-widget-protocol.md` must be merged first. This phase assumes
`/api/coach`, the widget registry, ChoiceList and ChangePreview all exist.

**Tech stack:** Next.js 15 App Router, `@ai-sdk/react` v3.0.216, `@ai-sdk/google` v3.0.86.
**JS/server only — reaches the device via a Railway deploy, no new APK.**

**Design source:** `docs/design/2026-08-08-ai-coach-conversational-ui.html` — §1 frames F1–F8 are the
target behaviour, §3 R1 is the resolved-widget rule, §4 settles name and entry. Round 3's P1–P2 are
history and offline.

---

## Task 1 — the route

- [ ] `app/coach/page.tsx` + `app/coach/coach-content.tsx`. Full page, not a sheet. Follows the
      `app/health/day/` shape from the day-detail screen — that is the recent precedent for a route
      outside the tab shell.
- [ ] It sits outside the bottom-nav shell, so it needs its own back affordance: a **48dp** back
      button in the header. The day-detail screen shipped with 44dp chevrons and had to be
      restructured; do not repeat that.
- [ ] Header uses the shared `pt-safe` / `pt-safe-or-4` utilities. **Never** combine with another
      `pt-*` class — CI fails the Custom Rules check on that, and the inset is lost anyway.
- [ ] The composer is bottom-anchored on a navless full-screen route, so it takes
      **`pb-safe-action-lg`** (`env + 2rem`, min 4rem), not bare `pb-safe`. On Android gesture-nav
      `env(safe-area-inset-bottom)` reports ~0 and a bare utility puts the send button under the
      gesture bar. This has regressed 11+ times.
- [ ] Confirm every utility class used actually exists in `app/globals.css` before relying on it.
      `.pt-safe-or-4` was referenced but undefined for a full release and failed silently.

## Task 2 — the thread

- [ ] Replace the hand-rolled `res.body.getReader()` loop with `useChat` from `@ai-sdk/react`. It is
      already a dependency (`^3.0.216`) with zero imports today, and it is what surfaces tool-call
      parts and provides `addToolResult`. Hand-rolling the UI message protocol would be a third
      streaming implementation in this repo.
- [ ] Render message parts: text → the existing `Response` markdown component; tool call → the
      widget registry; everything else → ignored, not crashed.
- [ ] Keep `next/dynamic({ ssr: false })` for the genuinely heavy deps only — markdown/KaTeX and
      chart.js. The widget components are lightweight and static-import.
- [ ] Charts stay in the text stream via the existing `parseChartBlocks`. They are output, not
      widgets, and rewriting them is not this phase's job.

## Task 3 — the resolved-widget rule

This is the single interaction that decides whether the surface reads as a conversation. Design
reference R1.

- [ ] When a widget resolves, it is **replaced by a normal user bubble** carrying the chosen label —
      as if the user had typed it. Not dimmed-in-place (R2), not a summary chip (R3).
- [ ] The bubble carries a small undo glyph; tapping it re-opens the picker.
- [ ] Widgets never persist in their interactive form once answered, so a scrolled-back thread reads
      as plain conversation.
- [ ] Typing always works instead of tapping. When the composer has focus and content, the live
      widget dims to show it has stepped aside. **Every widget has a typed equivalent** — the list
      is an accelerator, never a gate. Without this the feature is a menu with a chat skin.

**Verify:** walk F2 → F7 end to end at 412×891 against the local dev DB. Then walk it again typing
every answer instead of tapping, and confirm both reach the same patch.

## Task 4 — the model and grounding

- [ ] Move Coach to **`gemini-3.6-flash`**. Verified available on the owner's key 2026-08-08
      alongside `gemini-3.5-flash` and `gemini-3.1-pro-preview`; the app is otherwise on
      `gemini-3.1-flash-lite`. 3.6-flash is **GA rather than preview**, which is the deciding factor
      for the one route that writes to a training program, and it is materially better at choosing
      the right tool.
- [ ] Scope the change to Coach only. `AI_MODEL_ID` in `lib/ai/instrument.ts` is shared by every AI
      route; add a per-section override rather than moving the global. `lib/ai/__tests__/
      instrument.test.ts` asserts the current constant — the test should keep passing untouched.
- [ ] Enable **Google Search grounding** for research answers (owner decision, Q16). The
      `@ai-sdk/google` provider supports it. Without it, "what can I swap for 100g of rice" is
      answered from model memory, which is exactly where a confidently wrong macro number is
      plausible and unfalsifiable.
- [ ] Render provenance when an answer is grounded, and **say so when it is not** — an absent source
      line teaches nothing if absence is ambiguous.

**Verify:** a grounded research question returns source metadata; a pure-data question does not call
search at all (it should use the existing read tools, and search is wasted latency).

## Task 5 — persistence

Owner said yes to both halves. They have very different costs, so build them as two things.

- [ ] **Applied changes (cheap).** Already a `coach_changes` row from Phase 1. The history view lists
      them with one query and no new storage. This is the half with lasting value — it answers "when
      did I change that, and why" and nothing else in the app can.
- [ ] **Conversations (the expensive half).** A `coach_threads` + `coach_messages` pair, **30-day
      window**, no search. Prune on write rather than adding a scheduled job — there is no cron layer
      in this app (`docs/module-map.md` §0).
- [ ] Store message parts, not just text, or a reloaded thread loses its widgets and the scrollback
      is a lie about what happened.
- [ ] History view per round 3's P1: changes first, conversations second, "New conversation" at the
      bottom. If storage ever becomes a problem, the bottom half can be dropped and the top half
      still earns its place.

**Verify:** apply a change, close the app, reopen — the change is listed and the thread rehydrates
with its widgets intact (resolved ones as user bubbles).

## Task 6 — offline

- [ ] Coach is **online-only** (owner decision, Q18). It is the one surface that breaks the
      offline-first rule, so it must say so rather than fail quietly.
- [ ] An unsent message stays visible and dimmed instead of vanishing. A composer that swallows a
      message is the exact bug class this repo keeps re-fixing.
- [ ] The composer is visibly disabled with an explicit "You're offline" widget and a Retry.
- [ ] Persisted history stays readable offline — it is local.

**Verify:** device check. Airplane-mode behaviour behind the service worker cannot be exercised in
the sandbox.

## Task 7 — repoint the entry points

**All four are live.** This was mis-scoped once already — confirm each before removing anything.

- [ ] `components/overview-screen.tsx:315` — Home's text button.
- [ ] `app/stats/stats-content.tsx:174` — sparkles button.
- [ ] `components/workout/done-screen.tsx:553` — button.
- [ ] `app/session-select/session-select-content.tsx:1427` — renders `<AiChatOverlay>` **uncontrolled**,
      which makes the overlay draw its own floating FAB at `bottom-fab-safe right-6`. There is no
      button in that screen's own source, so this one is easy to miss and needs its own replacement
      affordance, not just a deleted line.
- [ ] All four navigate to `/coach`. Coach does **not** get a bottom-nav slot (owner decision, Q12).
- [ ] Delete `components/ai-chat-overlay.tsx` and `app/api/ai-chat/route.ts` **only once all four are
      repointed and verified**. Retiring them earlier strands a live entry point.

**Verify:** every one of the four, on the running app, reaching `/coach` and back.

---

## Deliberately not in this phase

- Widgets beyond ChoiceList and ChangePreview, and write domains beyond `session_exercise` —
  Phase 3.
- "Ask the coach about this" deep links from Stats/Health — owner deferred past v1 (Q13).
- The standing brief. Owner chose proactivity level (b): volunteer observations mid-answer, no
  brief-on-open. There is no cron layer to generate one honestly.

## Failure surfaces

This phase is the first with a user-facing surface, so it carries the device gate for everything
built in Phases 1 and 2. **`pnpm dev` green is necessary and not sufficient.** The on-device smoke
run (`docs/device-smoke-checklist.md`) must cover: the composer clearing the gesture bar, the header
clearing the status bar, widget tap targets, and offline behaviour behind the service worker. If no
device is available in-session, add a Known-Issues row in `projectOverview.md` marking it
not-yet-device-verified rather than claiming it works.
