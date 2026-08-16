# UB1 — First-open deep-link exchange yanks you back to home

**Source:** `docs/reviews/2026-07-09-user-reported-bugs.md` (finding UB1). **Branch:**
`fix/mobile-deeplink-redirect`. Client/JS only — ships via Railway into the WebView with
**no APK rebuild**. BUT the failing path is the Capacitor **cold-launch deep-link** handler
(`App.getLaunchUrl()`), which **no-ops in the web sandbox** (`Capacitor.isNativePlatform()`
is false and there is no `trainingai://auth-complete` launch URL), so `pnpm dev` cannot
reproduce or verify it — **on-device is the only real verification**. Device repro:
cold-launch the app via the OAuth deep link (sign in so the process is (re)launched from
`trainingai://auth-complete?token=…`), and while the token exchange is in flight navigate
to `/admin` (or anywhere off home); on `main` you are thrown back to `/` when the exchange
resolves — after the fix you stay put.

**Shipped (v1.124.9, 2026-07-10, session 256).** Both chunks landed. Chunk 1: `app/layout.tsx`
now passes `hasSession={!!userId}` to `MobileAuthHandler`, which gates the cold-launch
`getLaunchUrl()` exchange on `!hasSession` and tightens the post-exchange redirect to
`res.ok && window.location.pathname === "/sign-in"`. Chunk 2: `app/admin/page.tsx` now passes
`session.user.isAdmin` to `isAdminUser` — **deviated from the plan's literal "drop the `await`"
instruction**, since `isAdminUser` is declared `async function` and dropping `await` on an async
call makes `!isAdminUser(...)` always evaluate `!Promise` (always `false`), which would have
broken the non-admin redirect entirely; kept `await` (a resolved-Promise microtask, not a network
round-trip) so the DB-latency win is preserved without the correctness bug. `pnpm lint`/`tsc`/
tests/build all green. **Verified on the local dev DB (web-verifiable, Chunk 2 only):** a
non-admin hitting `/admin` bounces to `/` immediately; an admin reaches `/admin` without a
bounce. **Not exercised:** Chunk 1's actual fix (the deep-link cold-launch yank) is APK-only —
`Capacitor.isNativePlatform()` is false in the web sandbox, so `getLaunchUrl()` never fires;
device smoke not run this session.

**Goal:** stop the post-exchange `window.location.href = "/"` from hijacking navigation —
skip the redundant exchange entirely when the WebView already has a session, and, when an
exchange does run, only redirect if the user is still on the sign-in route.

---

## Background — why this only bites on an already-authenticated cold-launch

The Chrome Custom Tab that runs Google OAuth has a **separate cookie jar** from the
Capacitor WebView; the token-exchange mechanism exists solely to transfer the session into
the WebView's jar. Two cold-launch cases therefore differ:

- **First-ever sign-in (exchange genuinely needed):** the WebView has no session cookie, so
  the cold-launch server-render of `/` bounces to `/sign-in` (no session). The user sits on
  `/sign-in`, unauthenticated, with nowhere to navigate. `handleAuthUrl` exchanges the
  token, sets the cookie, and `window.location.href = "/"` is correct.
- **Re-launch when the WebView already holds a session (the UB1 case):** the WebView cookie
  persists across process restarts, so the cold-launch server-render of `/` authenticates
  and renders a **fully working home screen**. The user navigates to `/admin`. Meanwhile
  `App.getLaunchUrl()` still returns the `trainingai://auth-complete` URL that launched the
  process, so `MobileAuthHandler` fires a **redundant** exchange (the "set loading time"),
  and on resolve unconditionally `window.location.href = "/"` — yanking the user off
  `/admin` back home. That is UB1 exactly.

Current handler (`components/mobile-auth-handler.tsx:42-68`), verified at HEAD:

```tsx
async function handleAuthUrl(url: string) {
  if (!url.startsWith("trainingai://auth-complete")) return;
  const token = new URL(url).searchParams.get("token");
  if (!token) return;
  const verifier = localStorage.getItem("ta-mobile-auth-verifier");
  try {
    const res = await fetch("/api/auth/exchange-mobile-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, verifier }),
    });
    if (res.ok) localStorage.removeItem("ta-mobile-auth-verifier");
    await Browser.close().catch(() => {});
    window.location.href = "/";                    // ← UB1: unconditional, no pathname / session check
  } catch {
    // Non-fatal — user can retry sign-in
  }
}

// Handle deep link if app was cold-launched from the link.
const launch = await App.getLaunchUrl();
if (launch?.url) handleAuthUrl(launch.url);        // ← fires even when a session already exists
```

The exchange route (`app/api/auth/exchange-mobile-token/route.ts`) returns only
`{ ok: true }` and sets the session cookie — it carries no landing/next URL, so the client
owns the destination. The `res.ok` check already exists but the redirect happens regardless
of `res.ok`; the fix tightens the redirect condition, it does not need any route change.

---

## Chunk 1 — Scope the post-exchange redirect (UB1 primary)

Two independent layers, both in this PR. Layer A removes the redundant exchange for the
reported case; Layer B is a defensive guard so any exchange that *does* run can never yank a
navigated-away user. This is a security-adjacent flow, so both layers **fail closed toward
"do nothing"** (skip / don't redirect) rather than toward a surprise navigation — matching
the CLAUDE.md "AI & Security Defaults → fail closed" posture: the safe default when we are
unsure the exchange is still the active context is to leave the user where they are.

### Task 1 — Pass a `hasSession` signal from the server layout

The session cookie is `httpOnly`, so the client cannot read it directly. The root layout
already resolves the session server-side (`app/layout.tsx:90-91` — `const session = await
auth(); const userId = session?.user?.id;`), so hand the handler a boolean.

`app/layout.tsx:109` currently:

```tsx
<MobileAuthHandler />
```

becomes:

```tsx
<MobileAuthHandler hasSession={!!userId} />
```

This reflects the **cold-launch server-render's** auth state — exactly the "did the WebView
already have a session at first paint" question. On a first-ever sign-in it is `false`
(exchange needed); on an already-authenticated re-launch it is `true` (exchange redundant).

### Task 2 — Skip the redundant cold-launch exchange when already authenticated

In `components/mobile-auth-handler.tsx`, accept the prop and gate the **launch-URL** path
(`:67-68`) on `!hasSession`. Leave the `appUrlOpen` (warm, app-already-open) listener
firing unconditionally — that path is a deliberate in-app re-auth and is covered by Layer B.

```tsx
export function MobileAuthHandler({ hasSession }: { hasSession: boolean }) {
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    // ...
      // Handle deep link if app was cold-launched from the link.
      const launch = await App.getLaunchUrl();
      // Skip the redundant exchange when the WebView already had a session at
      // cold-launch: the server-render already authenticated us, so re-running
      // the exchange only risks the UB1 yank-to-home (finding UB1).
      if (!hasSession && launch?.url) handleAuthUrl(launch.url);
    // ...
  }, [hasSession]);
```

Add `hasSession` to the effect dependency array (it is stable per mount — the layout is a
server component, so the value does not churn — but ESLint's exhaustive-deps requires it).

### Task 3 — Pathname-guard the redirect (defensive, covers every exchange path)

Even when an exchange legitimately runs (first-ever sign-in, or a warm `appUrlOpen`
re-auth), only redirect if the user is **still on the sign-in route** when it resolves. The
needed-exchange cases always sit on `/sign-in` at exchange time (an unauthenticated
cold-launch is bounced there by the server; a warm re-auth is initiated from the sign-in
screen's Google button), so `=== "/sign-in"` is the precise "the auth flow is still the
active context" test and blocks the yank in every other case.

```tsx
async function handleAuthUrl(url: string) {
  if (!url.startsWith("trainingai://auth-complete")) return;
  const token = new URL(url).searchParams.get("token");
  if (!token) return;
  const verifier = localStorage.getItem("ta-mobile-auth-verifier");
  try {
    const res = await fetch("/api/auth/exchange-mobile-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, verifier }),
    });
    if (res.ok) localStorage.removeItem("ta-mobile-auth-verifier");
    await Browser.close().catch(() => {});
    // Only land on home if the user hasn't navigated away during the async
    // exchange. A cold-launch that already had a session renders a working
    // app the user may have moved off (e.g. to /admin) — redirecting them
    // back is UB1. The needed-exchange paths are always on /sign-in here.
    if (res.ok && window.location.pathname === "/sign-in") {
      window.location.href = "/";
    }
  } catch {
    // Non-fatal — user can retry sign-in
  }
}
```

Two tightenings vs. HEAD: gate on `res.ok` (a failed exchange must not navigate as if it
succeeded — fail closed), and gate on `window.location.pathname === "/sign-in"`.

**Why the pathname check and not a captured mount pathname:** capturing the pathname at
effect-mount and comparing on resolve is an alternative, but it is less precise for the
`appUrlOpen` warm path (the app may have been mounted for a while on some other screen
before the deep link arrives). The sign-in-route test keys off the semantic invariant — the
redirect-to-home is only ever wanted *from* the sign-in screen — so it is the more robust
choice. If the sign-in route path ever changes, this string is the single place to update.

### Notes / edge cases
- `res.ok === false` (bad/expired token → 401, or rate-limit → 429): with the fix we no
  longer redirect. The user stays on `/sign-in` and can retry — strictly better than being
  bounced to a `/` that (on a genuinely-unauthenticated device) would just re-bounce to
  `/sign-in` anyway.
- The `Browser.close()` call stays unconditional — closing the leftover Custom Tab is
  always correct regardless of exchange outcome.
- No change to `app/api/auth/exchange-mobile-token/route.ts` — it already sets the cookie
  and returns `{ ok: true }`; the client owns the destination decision.

**Verify (on-device only — web cannot reproduce; the launch-URL handler no-ops without a
Capacitor deep-link launch):**
- Build/sync the APK, sign out, sign in fresh (first-ever exchange): confirm you land on
  home after the exchange — Layer B's `/sign-in` guard still allows the intended redirect.
- Sign in again so the process re-launches from the deep link **with a session already in
  the WebView jar**; as soon as the app paints home, navigate to `/admin`; wait out the
  exchange — **you stay on `/admin`** (Layer A skipped the exchange; even if it ran, Layer B
  would not redirect). This is the UB1 repro.
- Warm re-auth: with the app already open on `/sign-in`, tap Google sign-in; on the deep
  link returning, confirm you still land on home (pathname is `/sign-in`, guard passes).
- Regression: normal cold-launch by tapping the app icon (no deep link) — `getLaunchUrl`
  returns no auth URL, handler no-ops, home renders as today.

---

## Chunk 2 — Admin redirect latency (secondary, optional / low priority)

Secondary contributor, **non-admin users only**, weaker match than Chunk 1 — include only
if cheap; it does not fix the reported (admin) case.

`app/admin/page.tsx:11` awaits an authoritative DB round-trip before deciding to bounce a
non-admin:

```tsx
if (!await isAdminUser(session.user.id)) redirect('/')
```

`isAdminUser` (`lib/admin.ts:22-27`) ignores the JWT flag and hits `repo.getUserById` — that
await is a visible delay on the way to `/admin` before the redirect fires, contributing a
"loads, then bounces home" flash for non-admins. The JWT already carries the flag
(`session.user.isAdmin`, typed in `types/next-auth.d.ts:14`), and `isAdminUser` already
accepts an optional boolean short-circuit (`isAdminUser(userId, isAdmin)` returns it
directly when a boolean is passed):

```tsx
if (!isAdminUser(session.user.id, session.user.isAdmin)) redirect('/')
```

(drop the `await` — the boolean-arg branch is synchronous.)

**Safety — this does not weaken any authorization.** The page-render gate is UX only; every
admin **action** goes through an admin API route that calls `requireAdmin`
(`lib/admin.ts:15-20`), which *always* does the authoritative DB check and 403s a
stale-admin token. So trusting the possibly-stale JWT flag for the *initial screen gate* can
at worst briefly show the admin shell to a just-revoked admin, whose every action then
fails server-side. That is an acceptable UX/latency trade for removing the DB await from the
critical render path. Keep the DB check authoritative where it matters (`requireAdmin`);
only the cosmetic gate trusts the JWT.

**Do not** change `lib/admin.ts` (`requireAdmin` / `isAdminUser`'s DB path must stay the
authoritative source — the comment at `lib/admin.ts:10-14` documents why); only the call
site in `app/admin/page.tsx` changes.

**Verify (on-device or web — this path is plain SSR, so `pnpm dev` DOES exercise it):**
sign in as a non-admin and navigate to `/admin`; confirm the bounce to `/` happens without
the loading pause. Sign in as an admin and confirm `/admin` still renders. Because this
touches only server-render timing (not the deep-link path), it is the one part of this PR
verifiable in the web sandbox.
