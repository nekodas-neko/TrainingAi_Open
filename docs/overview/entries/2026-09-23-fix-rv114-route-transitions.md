# 2026-09-23 — RV-114: pushed routes animate

**Branch:** `fix/rv114-route-transitions` · **Lane B**

## What shipped

Seven call sites swapped from `useRouter` to `useTransitionRouter`. Import-only, as the entry
predicted. The plan was re-verified against `main` first: all seven still matched, and every usage
is a `push` or a `back` — never a `refresh` — so nothing animates that should not.

| File | navigates |
|---|---|
| `components/more/friend-leaderboard.tsx` | `push('/profile/…')` |
| `components/more/friend-feed.tsx` | `push('/profile/…')` |
| `app/nutrition/nutrition-content.tsx` | `push('/coach?scope=nutrition')` |
| `app/register/register-form.tsx` | `push('/sign-in?registered=1')` |
| `app/coach/coach-content.tsx` | `back()` |
| `app/coach/confirm/[toolCallId]/confirm-content.tsx` | `back()` ×4 |
| `app/collection/collection-content.tsx` | `back()` |

## The asymmetric pair was the point

Both friends surfaces pushed `/profile/${userId}` with a plain router while that screen's own back
runs the `"back"` keyframes — **open hard, close animated**, the exact inversion
`lib/hooks/use-back-or-fallback.ts` exists to prevent. Nothing at the call site looks wrong, which
is why it is pinned by a test rather than left to review.

## The `/coach` hazard is answered, not deferred

The entry flagged that `lib/view-transition.ts`'s 300 ms cap freezes the outgoing screen if the
destination never commits, and that `/coach` and `/coach/confirm/[toolCallId]` are dynamic routes.

Reading it: `navigate()` is called unconditionally inside the promise executor, **before** the
commit poll starts. The deadline only resolves the promise that ends the frozen snapshot. So a
destination that never commits costs a held frame, never a lost push — a 300 ms hold, exactly as the
entry expected, now with a reason attached rather than a "check this".

## Verification

- `lib/__tests__/rv114-pushed-routes-animate.test.ts` — 9 assertions: each of the seven uses
  `useTransitionRouter` and carries no bare `useRouter`; both friends surfaces still push a profile
  *and* animate it; and `useTransitionRouter` still spreads the real router, so a change there
  cannot silently drop `refresh`/`prefetch` from seven call sites without a type error.
- Control: reverting `friend-feed.tsx` fails 2 of 9.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 77 of 77** · full suite green · build clean.

## Deliberately not done

**No repo-wide ratchet.** 16 files still use a plain `useRouter` and most are right to: a tab href
needs no transition (`useTransitionRouter` already no-ops for those) and a `refresh()` is not a
navigation. Widening this is its own entry, not a free extra.

## Not exercised

Device. This is motion on daily paths and the sandbox can only prove the call sites changed —
whether the shared-axis transition reads right on the S25 is a look judgement. `/coach` is the one
worth watching, being a dynamic route. Also not exercised: native SQLite, safe-area, Samsung WebView.
