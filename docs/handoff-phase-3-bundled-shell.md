# HANDOFF — Phase 3 (bundle the shell into the APK)

_Updated: 2026-07-29 · Branch: `feat/bundled-shell-client-auth` · Author session: current_

> **Corrected 2026-07-30:** this file carries expensively-obtained negative results about Phase 3
> (see "Gotchas / what did NOT work" below) that exist nowhere else in the repo — losing them costs a
> session. Keep it until Phase 3 fully lands (Task 3 + the owner's Task 4 pick), then fold anything
> still load-bearing into the plan doc and retire this file. It now also matches the standing dated
> `docs/handoff-YYYY-MM-DD-<title>.md` convention (see `.claude/skills/handoff/SKILL.md`), so it no
> longer needs special-case deletion — treat it like any other handoff doc.
>
> **Live status has moved on since this was written** — check `docs/implementation-backlog.md`'s
> Q-1 entry for the current Phase 3 state, not the "Current status"/"Done" sections below, which
> describe a branch (`feat/bundled-shell-client-auth`) that merged and no longer exists.

## Goal

Serve the app shell from the APK instead of fetching it from Railway on every cold start. Per the
owner's direction this is **architecture, not an optimisation** — it is the step that stops the shell
coming from a server at all. Plan:
[`docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md`](superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md).

## Done

- **Task 1 — auth model decided.** Owner chose bearer-token-in-native-secure-storage. Recorded in the
  plan at `### ✅ DECISION`, with what it commits us to (cookie *and* bearer through one shared
  helper; bearer widens transport not authority; Capacitor secure storage, **not** `localStorage`).
- **Task 2 — static-export spike run and discarded.** Result in the plan at `### ⚠️ SPIKE RESULT`.
- **Task 2b — auth preconditions written** (three corrections to Task 3, one an auth hole).
- **Task 4 — rewritten as an owner gate** with three concrete options costed.
- Backlog Q-1 Phase 3 row updated with the above.

## Next task (start here)

1. **Task 3 — move authentication client-side.** It is **ready now and not blocked by the Task 4
   gate**, because a bearer token is needed under all three build-split options. Start at the plan's
   Task 3 Step 1 (build the client session hook once), **after reading Task 2b**.
2. Convert one page, verify, commit, repeat. `app/layout.tsx` **last**.
3. Its merge is **confirm-first** — auth-boundary change under `CLAUDE.md`'s Safety rules. Do not
   auto-merge on green CI.

## Key decisions (with rationale)

- **Bearer token = the existing NextAuth session JWT.** Not a new credential. The PKCE mobile flow is
  already built (`/mobile-signin` → Google → `/auth-mobile-bridge` mints a one-time challenge-bound
  token → `trainingai://` → `/api/auth/exchange-mobile-token`), and the value it carries
  (`TokenEntry.sessionCookieValue`) *is* that JWT. One token type, two transports — same key, claims,
  expiry and revocation. Don't invent a token type without a reason this can't serve.
- **Secure storage, not `localStorage`.** A session token in `localStorage` is readable by any
  injected script in the WebView — a real downgrade from the current `httpOnly` cookie.
- **The cookie path stays working throughout**, which is what makes Tasks 1–3 individually revertible.

## Gotchas / what did NOT work

- **`output: 'export'` is a whole-app flag.** It does not export the shell and leave `app/api` alone.
  Measured on `main`: 195 API routes, **105** with a non-GET handler, and of the 89 GET-only ones
  **87** call `await auth()` → dynamic. ~2 of 195 are exportable. **The original Task 4 cannot work.**
- **`pnpm build` gives you no inventory.** Task 2 Step 2 said to capture the failure list; Next stops
  at the *first* incompatible route. The counts above were enumerated by hand — the thing the plan
  warned would be less reliable was the only option.
- **`output: 'export'` disables `next.config.ts` `headers` entirely**, not just the `connect-src` line
  Task 4 anticipated. That's the CSP *and* the `stale-while-revalidate` headers the aggregate GET
  routes rely on. The shell's CSP has to be delivered by `<meta http-equiv>` or the native layer.
- **A whitelist cannot reproduce the middleware matcher.** It's a negative pattern — every new route
  is guarded by default today; under a positive list every new route would be public by default.
- **`isActive` is enforced in exactly one place** (`middleware.ts:18`) and static export runs no
  middleware. Reproduce *both* predicates client-side or deactivated users get into every screen.

## Files to look at

- `docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md` — the plan; read Task 2b
  and Task 4 before touching anything
- `middleware.ts` — the matcher and `PUBLIC_PATHS`; the thing Task 3 Step 4 replaces
- `auth.ts` / `auth.config.ts` — where `isActive` is set (sign-in only) and why deactivation is stale
- `lib/mobile-auth-tokens.ts`, `app/api/auth/exchange-mobile-token/route.ts`,
  `app/auth-mobile-bridge/page.tsx` — the PKCE flow the bearer path reuses
- `components/google-sign-in.tsx:29` — opens `/mobile-signin?challenge=…`; see the open bug below

## Open questions / blockers

- **BLOCKER — Task 4 needs an owner decision:** A (two builds from one repo), B (split into two apps
  in a workspace), or C (abandon export). Costed in the plan. Recommendation, not a decision: **B** if
  Phase 3 is architecture (the stated reason), **A** to get something on-device sooner. Task 3 does
  **not** wait on this.
- **PR #903 is open, redundant, and should be closed** — #902 shipped the same Q-25 fix with a better
  factoring; its two salvageable pieces are already on `main` via #907. Closing a PR is confirm-first.
- **Probable live bug, filed not fixed:** `/mobile-signin` is behind the auth gate. Measured,
  unauthenticated: `307 → /sign-in` with the `?challenge` dropped — the exact state of a fresh
  install, where the deep link that hands the APK its session then never fires. Breaks *first* sign-in
  only. Fix is likely one line (add to `PUBLIC_PATHS`, granting no authority `/sign-in` doesn't
  already grant) but it edits the auth boundary and wants a real first-run install to confirm.
  Known Issues row in `projectOverview.md`.
- **Also filed:** deactivating a user doesn't take effect until their JWT is re-minted
  (`auth.config.ts:35` sets `isActive` only at sign-in). Pre-existing; gets easier to get wrong once
  gating moves client-side.
- **Minor:** `CLAUDE.md` lists six required CI checks including "Type Check", but `ci.yml` defines
  five — type checking rides inside Build. Worth folding into whatever touches that file next.
