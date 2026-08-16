## 2026-07-29 — Phase 3: land the decision + spike record, reshape Task 4, and hand off

Branch `feat/bundled-shell-client-auth`. Docs only — no application code changed.

Session-closing PR. Carries two commits that were written earlier in the session, pushed, and then
**never merged** — the owner's Task 1 decision and the Task 2 spike result. They were sitting on an
unmerged branch while `main` moved four PRs ahead; rebased and landed here. That near-miss is the
reason this entry exists at all: a pushed branch is not a landed one.

### What was already on `main` before this

- **#907** — tests for the Q-25(a) activity-type guard (#902 shipped it untested), plus the Phase 4
  ledger correction (the backlog still said "ready to implement" when #897 *was* Phase 4).
- **#908** — Task 2b, the auth preconditions, plus two Known Issues rows.

### What this PR adds

**Task 1's decision record.** Owner chose Option A, bearer token in native secure storage. Written
into the plan with what it commits us to, so it isn't re-litigated per task: cookie *and* bearer
through one shared helper; bearer widens transport, not authority; Capacitor secure storage rather
than `localStorage`, because a session token in `localStorage` is readable by any injected script in
the WebView and that would be a real downgrade from the current `httpOnly` cookie.

**The spike result.** `output: 'export'` is a whole-app flag — it does not export the shell and leave
`app/api` alone. Measured on `main`: 195 API routes, **105** carrying a non-GET handler, and of the 89
GET-only ones **87** call `await auth()`. About 2 of 195 are exportable. Task 2's own method also
failed: it said to capture the build's inventory of incompatible routes, but Next stops at the first
one, so the counts were enumerated by hand — the approach the plan warned would be less reliable was
the only one available.

**Task 4 rewritten as an owner gate.** The original steps (flip the flag, drop `server.url`, sync)
cannot work, so they are demoted to *Task 4c* — still correct, but only after the build is split.
Three options are costed: A two builds from one repo, B split into two apps in a workspace, C abandon
export. Recommendation recorded as a recommendation (B if this is architecture, A to get on-device
sooner) and explicitly not chosen.

**Task 3 marked ready and unblocked.** It is a prerequisite under all three options — every one serves
the shell from a different origin than the API — so it does not wait on the gate. Backlog Q-1 updated
to say so, since the gate would otherwise read as blocking the whole phase.

**A handoff doc** at `docs/handoff-phase-3-bundled-shell.md`. It is on `main` deliberately: the sandbox container is ephemeral
and merged branches are auto-deleted, so a handoff riding a feature branch would vanish. It says of
itself that it is transient and should be deleted when Phase 3 lands.

### Two things filed rather than fixed

Both are auth-boundary edits, which are confirm-first, and both are in `projectOverview.md`'s Known
Issues:

- **`/mobile-signin` is behind the auth gate.** Measured: unauthenticated `307 → /sign-in` with the
  `?challenge` dropped — the state of a fresh install, where the deep link that hands the APK its
  session then never fires. Likely a one-line fix; wants a real first-run install to confirm, since a
  browser already carrying a session masks it entirely.
- **Deactivation doesn't take effect until the JWT is re-minted** (`auth.config.ts:35` sets
  `isActive` only at sign-in). Pre-existing, and it gets easier to get wrong once gating moves
  client-side.

### Not verified

- **Nothing on device**, and nothing in this PR is device-testable — it is documentation.
- **No application code changed**, so there is no runtime behaviour to have exercised. `pnpm dev` was
  run once, only to measure route gating for the `/mobile-signin` finding.
- **The bearer-token-is-the-session-JWT conclusion is from reading** `exchange-mobile-token` and
  `mobile-auth-tokens.ts`, not from a request that actually authenticated by header. Task 3 Step 1
  should prove it before the other 20 sites depend on it.

No version bump — docs only.
