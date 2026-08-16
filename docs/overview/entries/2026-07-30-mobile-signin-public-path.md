# 2026-07-30 — `/mobile-signin` made public; the deactivation fix retracted

Branch: `fix/mobile-signin-public-path` · v1.242.3

Taken from Q-1 (Phase 3), which lists two adjacent auth-boundary fixes to do *before or alongside*
Task 3. One is fixed here; the other turned out to be misdescribed and is now a decision for the
owner rather than a task.

## Fixed — first-run APK sign-in was impossible

`components/google-sign-in.tsx:29` opens `https://…/mobile-signin?challenge=<sha256>` in a Chrome
Custom Tab to start the Capacitor OAuth flow. `/mobile-signin` was not in `middleware.ts`'s
`PUBLIC_PATHS`, and the existing `/sign-in` entry does not cover it —
`"/mobile-signin".startsWith("/sign-in")` is `false`.

On a fresh install the Custom Tab holds no Railway session, so the gate redirected to `/sign-in` and
**dropped the `challenge` param**. Without it there is no PKCE binding, `/auth-mobile-bridge` is never
reached, and the `trainingai://` deep link that hands the app its session never fires. It only worked
when the system browser already carried a session from a previous sign-in — which is why it went
unnoticed: it breaks *first* sign-in, not subsequent ones.

Fix is one line. It grants no authority `/sign-in` doesn't already grant — the page's only action is
`signIn("google")`, re-read to confirm before applying.

### Measured (A/B against `pnpm dev`)

| | `GET /mobile-signin?challenge=abc123` | control `GET /health` |
|---|---|---|
| before (`main`) | `307` → `/sign-in`, param dropped | `307` → `/sign-in` |
| after | **`200`** | `307` → `/sign-in` |

The control matters: the gate itself is unchanged, only this one path is exempt.

`pnpm tsc --noEmit` clean · `pnpm lint` 0 errors (119 pre-existing warnings) · 2793 tests pass.

**Not verified: a real first-run install.** The middleware half is proven; the full PKCE chain — fresh
APK, no browser session, through Google, to the `trainingai://` hand-back — cannot be exercised in the
sandbox. That is the only thing that proves the bug is actually *closed* rather than one step less
broken.

## Retracted — the deactivation fix as previously written cannot work

Both `projectOverview.md` and the backlog recorded the sibling issue (a deactivated user keeps access
until their JWT is re-minted) as **"cheap to fix — re-check per request against the now-co-located
Postgres."** That is wrong, and both have been corrected.

`middleware.ts:18` is the only place `isActive` is enforced, middleware runs on the **Edge runtime**,
and it imports `auth.config.ts` — which is Node-free by design. Its own header says so: *"Edge-
compatible config — no Node.js-only imports (no bcrypt, no pg)."* A per-request Postgres check cannot
live there.

The genuine options, none free: (a) re-read `isActive` in `auth.ts`'s Node-side jwt callback on
refresh — bounds staleness to `updateAge` (~24 h) rather than closing it; (b) a Node-side re-check at
a server choke point (root layout, or a shared `requireActiveUser()`), leaving middleware as the fast
path — closes it, at a query per server render; (c) shorten `maxAge`/`updateAge` — blunt, more
frequent re-auth for everyone; (d) Next's experimental Node middleware.

**Left for the owner to pick.** It is a security-boundary trade (staleness window vs per-render cost),
not an implementer default, and Phase 3's Task 3 moves route gating client-side — where trusting a
stale claim is materially easier to get wrong — so it wants deciding before that lands.

## Note on the merge

Auth-boundary change, so confirm-first per CLAUDE.md regardless of CI.
