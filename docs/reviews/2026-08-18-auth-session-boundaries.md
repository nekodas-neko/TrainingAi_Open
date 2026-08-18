# Review — auth and session boundaries: does revoking access actually revoke it?

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** privilege revocation and fail-closed secret gates
**Findings filed:** Q-479 · **Clean results recorded:** five

## Why this lens

`CLAUDE.md` states the rule flatly: *"Security checks fail **closed**: a missing signature header,
missing signing key, or oversized/mistyped input is a rejection, not a skip."* Eleven sweeps had
tested cross-user *data* isolation extensively and never tested **privilege revocation** — whether
taking someone's admin away actually takes it away, and whether the secret-gated routes reject when
their secret is absent.

Method: local `pnpm dev`, a real credentials login, and an A/B with a control on every probe — a
`requireAdmin` route run beside the route under test, so a `403` proves the revocation and not the
harness.

---

## Finding (Q-479) — a revoked admin can still write to the shared exercise catalogue for up to 24 hours

### The two admin checks disagree, in the same file

`lib/admin.ts`:

```ts
export async function requireAdmin(userId: string, _isAdmin?: boolean): Promise<void> {
  // ... ignores _isAdmin, reads the row
  const user = await repo.getUserById(userId)
  if (!user?.isAdmin) throw new AdminError()
}

export async function isAdminUser(userId: string, isAdmin?: boolean): Promise<boolean> {
  if (typeof isAdmin === 'boolean') return isAdmin        // ← trusts the caller
  const user = await repo.getUserById(userId)
  return user?.isAdmin ?? false
}
```

`requireAdmin`'s underscore-prefixed `_isAdmin` is deliberate and correct: it accepts the argument for
signature compatibility and refuses to trust it. **61 API routes use it.** `isAdminUser` trusts the
argument when given one.

Ten sites call `isAdminUser`; **seven pass `session.user.isAdmin`** — the JWT claim. Six of those
seven are page guards (`app/admin/page.tsx`, `app/more/settings/developer/*`), which is UI. **The
seventh is an API write route**: `app/api/exercises/route.ts:38`, gating `createExercise` — a write
into `exercise_library`, the catalogue every user reads.

### The claim is refreshed, but only once a day

`lib/auth/is-active-refresh.ts` re-reads `isActive` and `isAdmin` from the database inside the jwt
callback, throttled by `ISACTIVE_RECHECK_MS = 24 * 60 * 60 * 1000` — one read per user per day,
because *"NextAuth's jwt callback runs on every `auth()` call … an unthrottled read would be a DB
query per request."* That throttle is a sound decision. The problem is what the module then claims:

> *"This governs the **UI** only: `requireAdmin` reads the row from the database on every call and
> never trusts this claim. The claim decides whether the admin entry point is drawn."*

**That statement is false**, and it is the reason this is easy to miss: a reviewer who reads it stops
looking. `app/api/exercises/route.ts` is not UI, and it does trust the claim.

### Measured

Admin granted in the DB, fresh login, token warmed, then admin revoked in the DB — **no re-login**,
cookie rotation persisted exactly as a browser would:

```
### REVOKE in DB, cookie persisted across requests ###
  POST /api/exercises    = 201   ← isAdminUser, JWT claim
  GET  /api/admin/errors = 403   ← requireAdmin, DB read   (the control)
  session claim still says: isAdmin = True

  select name from exercise_library where name like 'ZZ Probe%';
       name
  ------------------
   ZZ Probe Revoked          ← the row a revoked admin created
```

The control is what makes this a finding rather than a guess: the same cookie, the same instant, one
route refusing and the other admitting. The row exists in the shared catalogue.

**Window: up to 24 hours**, bounded by `ISACTIVE_RECHECK_MS`.

### Severity, honestly

**Moderate-low, and worth fixing anyway.** What a revoked admin gains is the ability to add rows to
`exercise_library` — a catalogue, not user data. No health data, no other user's rows, no
credentials. Nothing else in the app trusts the claim from an API route.

What makes it worth an entry rather than a note: it is **privilege persistence with a demonstrated
proof of concept**, the fix is deleting one argument, and the module's own docstring asserts the
invariant this breaks — so the next person to add an admin-gated API route has a documented reason to
believe `isAdminUser(id, session.user.isAdmin)` is safe. The wrong comment is more dangerous than the
wrong call, because it scales.

### Fix shape

1. **`app/api/exercises/route.ts:38`** — drop the second argument (`isAdminUser(session.user.id)`),
   or use `requireAdmin` like the other 61 routes. One line either way; `requireAdmin` is better
   because it makes the file match its siblings.
2. **Correct the docstring** in `lib/auth/is-active-refresh.ts` — "governs the UI only" is the claim
   that has to become true, and step 1 is what makes it true. Worth saying explicitly that an
   API route must never pass the claim.
3. **Optional ratchet**, if this is judged worth preventing structurally: fail the Custom Rules job on
   `isAdminUser(` with a second argument inside `app/api/**`. Cheap, and it is the shape this repo
   already uses for rules that prose did not hold.

---

## Clean results — recorded so the next sweep does not re-run them

- **61 admin API routes re-read the database.** `requireAdmin` ignores the passed flag by
  construction. Revocation is immediate everywhere except the one route above.
- **The six page guards are genuinely UI**, so they match the docstring: a revoked admin sees the
  admin page shell for up to 24 h, and every API call behind it returns 403. Not filed.
- **`/api/health-connect/ingest` fails closed properly** — with `HEALTH_CONNECT_INGEST_SECRET`
  **unset**, a schema-valid body with any secret returns 401, and so does an empty secret string
  (`!expectedSecret || !safeCompare(...)`). It also runs an IP rate limit *before* the constant-time
  compare and returns an identical 401 body on trip, so a brute-force cannot distinguish rate-limited
  from wrong-secret. This is the reference implementation for the fail-closed rule.
- **Both bearer paths fail closed on partial configuration.** `/api/admin/day-review` with the real
  `ADMIN_EXPORT_SECRET` but no resolvable user (`ADMIN_EXPORT_USER_ID`/`WEBHOOK_USER_ID` unset) → 401.
  `/api/admin/db-query` with the real `CLAUDE_DB_QUERY_SECRET` but `CLAUDE_DB_READONLY_URL` unset →
  401. Both match what `CLAUDE.md` documents: the token widens transport, never authority.
- **The claim refresh itself is well-built.** It refuses to treat a missing row as deactivation, does
  not advance its timestamp on a failed lookup (so the next request retries rather than waiting a
  day), never strips a claim a lookup omitted, and swallows DB errors so a blip cannot sign everyone
  out.

---

## Method note that nearly produced a false clean

**My first run of this test reported that revocation worked, and it was wrong.**

The probes used `curl -b cookies.txt` **without `-c`**, so every response's rotated session cookie was
discarded and each request re-sent the original token — one with no `isActiveCheckedAt` stamp. The
throttle therefore never engaged, the claim was re-read from the database on *every* request, and the
JWT-trusting route dutifully returned 403. A clean result, produced entirely by the harness.

Re-running with `-b` **and** `-c` on the same file — which is what any browser does — produced the
201 above.

**The rule to carry: a session-staleness test is meaningless unless the client persists cookie
rotation.** Any finding about a stale claim, a refresh throttle, or a token's lifetime must be run
with a cookie jar that is written back, or it measures the opposite of what it claims to.

## Not verified

Local `pnpm dev` only. Not on the APK (the WebView keeps cookies, so it behaves like the corrected
harness, not the first one) and not against production — inducing an admin revocation there is not
something to do for a measurement. `ISACTIVE_RECHECK_MS` is read from source, not observed over a
real 24-hour window.
