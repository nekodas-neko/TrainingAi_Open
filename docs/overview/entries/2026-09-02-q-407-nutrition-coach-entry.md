# 2026-09-02 — Nutrition's plan button opens the coach, in the nutrition scope (Q-407)

**Lane B · branch `feat/q-407-nutrition-coach-entry` · v1.433.0**

Q-407 became startable when LA-47's plan card merged. Its remaining Lane B half was small and precise:
*"pointing the Nutrition tab's entry at `/coach` with `scope: "nutrition"` (the route reads a `scope`
in its body and nothing sends one yet)"*.

## Every premise checked out, which is worth saying

Four entries this session were confidently wrong about their own code, so all four claims were
verified against `main` first: `lib/coach/scopes.ts` exists and carries a `nutrition` scope;
`app/api/coach/route.ts` parses `scope: z.string().max(40).optional()` and resolves it through
`coachScope`; `app/coach/` is a real page; and **nothing on the client sent one** — a `grep` for
`scope` across `coach-content.tsx` and `components/coach/` found only an unrelated comment. Q-407's
description of its own remaining work was exact.

## What shipped

`/coach` takes `?scope=`, the page awaits `searchParams` and passes it down, and `CoachContent`
forwards it through `DefaultChatTransport`'s `body`. Nutrition's `Build a meal plan` navigates to
`/coach?scope=nutrition`.

**A search param rather than a route or a separate page**, because the API already treats the scope as
optional and falls back to `general` on an unknown one — so a link from an older build cannot 400, and
the entry point stays a plain navigation. The transport is memoised on the scope: `useChat` reads the
transport it is handed, and a fresh instance every render is how a chat loses its in-flight request.

## The stepper sits beside the conversation, not behind it

The entry is explicit: *"a conversational flow that stalls mid-plan with no fallback is strictly worse
than seven screens that finish."* The obvious reading — leave Rebuild as the way back — does not hold,
because **Rebuild does not exist until a plan does**. The user with no plan is precisely the one who
would be stranded, and that is the only state the create button appears in.

So a `Prefer the step-by-step setup?` control sits directly under the same button, in the same empty
state. `onCreate` is the conversation; `onStepByStep` is the sheet.

## Verification

- **`e2e/nutrition-coach-plan-entry.spec.ts`, 2 tests, four mutations kill them**: the scope dropped
  from the transport, the entry navigating to a bare `/coach`, the fallback control hidden, and the
  fallback opening the coach instead of the sheet.
- **The spec asserts the POST body, not the URL.** The scope decides the tool subset — *"a tool it
  never receives is a boundary it cannot cross"* — so a test that only checked `/coach?scope=nutrition`
  would pass against a coach running in the general scope, which is the failure worth catching. It
  drives one real turn so the transport actually posts; without that the page is on `/coach` having
  sent nothing.
- **`test.use({ serviceWorkers: 'block' })`, and the gate is what caught its absence.** The spec stubs
  `/api/coach`, the service worker re-issues every `/api/` request, and Playwright cannot intercept a
  service-worker fetch — so the stub would apply or not depending on whether the worker had claimed the
  page. It would have passed locally and failed on CI with the real route answering.
- Full unit suite **744 files / 6,326 tests**; `pnpm check:rules` **Ran 67 of 67**; `tsc` clean; lint
  clean (the one warning is pre-existing).

A mutation run was cut off by a timeout mid-sweep and **left the mutation applied to the working
tree** — the baton's own warning, met in practice. It was caught by diffing before continuing, and the
fourth mutation was then run on its own.

## What is deliberately not done

- **The conversation's own shape.** The coach does not yet *open* by stating what it already knows
  instead of asking, which is points 1 and 2 of the entry's three-part design. The widgets exist and
  the model can now reach them inside the nutrition scope; what is missing is prompt and tool-ordering
  work in `lib/coach/**` and `app/api/coach/route.ts` — **Lane A**. Nothing in Lane B blocks it.
- **The stepper is not deleted.** The entry's condition is that the conversation has been used
  on-device for a plan the owner actually keeps.

**Not exercised:** no real Gemini turn — the spec stubs `/api/coach` because it asserts what the client
sends, and a live call would make it depend on a model and a key. So the scope reaching the API is
proven; the coach *behaving* differently inside it is not. The device is untouched: the safe-area under
the composer and a widget inside a scrolling thread are both unverified at 412 dp.
