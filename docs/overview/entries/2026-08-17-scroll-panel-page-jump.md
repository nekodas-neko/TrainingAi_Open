# 2026-08-17 — Q-532: a streaming panel that scrolled the whole page

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.317.6 · **Lane:** Implementation B

## The report and the cause

Owner, during the Oura re-sync runbook: *"The screen constantly moves to the centre while a scan is
running — making it hard to click buttons."*

The entry guessed at "a `scrollIntoView` / auto-scroll on new log lines, or a keyed remount", and
pointed at `oura-ble-debug.tsx`. It was the first of those, one file over —
`components/oura-ble/log-console.tsx:17`:

```ts
useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'auto' }) }, [lines.length])
```

`endRef` is a sentinel `<div>` at the bottom of a `h-64 overflow-y-auto` panel. **`scrollIntoView`
scrolls every scrollable ancestor up to the document, not just the nearest one** — so each log line
appended during a drain scrolled the log panel *and* the page. That is the whole bug. It is not a
re-render or remount problem, and the screen's polling was a red herring.

Why it matters more than an annoyance, per the entry: this screen is only used during a live drain,
which is the one situation where a mistimed tap can hit **Clear key**.

## The fix

`lib/hooks/use-scroll-to-bottom.ts` — the ref goes on the scrolling container itself and the effect
assigns `scrollTop = scrollHeight`, which cannot escape that element. The sentinel `<div>`s are
gone from both call sites.

Extracted rather than inlined twice because the repo's rule is that a pattern at ≥2 sites gets
extracted before a third copy, and because the reason not to reach for `scrollIntoView` is exactly
the kind of thing that needs to be written down once.

## The sibling sweep, which found a second instance

CLAUDE.md requires grepping for every other surface with the same pattern. Five `scrollIntoView`
calls exist. Sorting them by whether the target sits inside its own scroll container:

| Site | Verdict |
|---|---|
| `oura-ble/log-console.tsx` | **The bug.** Sentinel inside `h-64 overflow-y-auto`. Fixed. |
| `workout-builder/builder-review.tsx` | **Same defect.** Sentinel inside `max-h-48 overflow-y-auto`, itself inside a `flex-1 overflow-y-auto` panel — so every streamed chat message moved the review page under the user while they were editing exercises. Fixed. |
| `coach/coach-content.tsx` | **Correct as written.** No inner scroll container in that file; the page *is* the scroller for a full-screen chat, so scrolling it is the intent. Left alone. |
| `profile/level-sheet.tsx` | Not this bug — one-shot on sheet open, user-initiated. |
| `health/contributor-chart.tsx` | Not this bug — fires from a tap handler, user-initiated. |

The builder-review one is the find. Nobody reported it, and it would have behaved identically to
the reported bug on a screen with a genuinely destructive neighbour (Save/Discard on a program).

## What was NOT exercised — this is the important part

**Neither fix is device-verified, and the reported bug is not reproducible in the sandbox at all.**
The entry says so itself: a BLE scan cannot run here, and a static screenshot would not show it.
What I have is a precisely identified mechanism and a fix whose correctness follows from documented
DOM behaviour — not an observation of the symptom disappearing.

**No automated guard was added, deliberately, and the reason is a capability gap rather than a
judgement call.** Both vitest projects run `environment: 'node'` and there is no
`@testing-library/react` in the repo, so there is no way to render a component and assert on scroll
position without introducing component-test infrastructure — which is its own item, not a rider on
a two-line fix. The E2E harness cannot reach it either: `/admin/oura-ble` needs an admin session and
a live radio.

So the regression risk is real and unmitigated: someone can reintroduce `scrollIntoView` on a
sentinel and nothing will fail. The `module-map.md` row and the hook's own comment are what stand in
for a test. A CI rule flagging `scrollIntoView` inside a `useEffect` (allowlisting the two
legitimate uses, the way `check-api-no-store.js` allowlists `/api/version`) would mechanise it
properly — considered and not built here, because adding a 39th custom rule is a call worth making
on its own rather than inside an unrelated fix.

**Also not exercised:** Samsung WebView rendering, and the workout-builder chat end-to-end (it needs
live AI calls). The full suite (377 files, 3327 tests) and all 14 E2E specs pass, but none of them
touch either changed panel.

## Q-531 skipped, and marked blocked rather than passed over

Q-531 sits above Q-532 and is also `[app-shell]`, so it was the higher Lane B item. It asks for the
premise of a shipped IA decision (Q-234) to be re-litigated against a real user's task. The owner's
report is the only evidence of what that task is, and an agent picking the new structure alone would
repeat precisely the failure the entry describes — Q-234 reasoned taxonomically, correctly on paper,
and was wrong in use. It is annotated `⛔ blocked: needs an owner decision` in place, per the
backlog protocol, with what would unblock it.
