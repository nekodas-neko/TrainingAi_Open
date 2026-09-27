# 2026-09-27 — the four owner-gated security PRs, run locally for the first time

Lane A's previous session built #1779, #1781, #1784 and #1789 in a cloud container that could not
run `pnpm dev` or `pnpm start`. This session ran on the owner's Windows machine. Each PR's own
journal entry now carries its result; this entry records what belongs to none of them.

## What the runs showed

| PR | result |
|---|---|
| #1779 RV-192 | invited and uninvited password registrations both start inactive; the invitee reaches `/pending` with no session; an existing password account still signs in |
| #1781 RV-193 | with a minted cookie, the calendar route reads the refresh token server-side and reaches Google; `/api/auth/session` no longer carries it. Control on `main`: it does |
| #1784 RV-195 ② | deleting the row takes a live session to 401 on the next request |
| #1789 RV-197 | no CSP violations across four screens on `pnpm dev`. **The production header is still unread**, because `next start` refuses to boot on the local storage keys (`SignatureDoesNotMatch (403)`) |

All four were merged up to `main` (#1779 re-bumped to 1.477.14) and left unmerged: they are
owner-gated.

## Filed and amended

- **`LA-162`** (Lane B, `Needs: RV-192`): the sign-in toast after registering says *"or wait for
  approval if not yet invited"*, which RV-192 makes wrong for invited registrants. It also records
  an unconfirmed dev-mode observation that the register form's redirect did not fire.
- **`PS-24`**, re-measured in a real browser: immediate revocation holds. The amendment names the
  one thing that would undo it: any app call to `/api/auth/session` stamps the cookie and restores
  the one-day throttle. It also corrects a sentence about `GET /` redirecting, which it no longer
  does.

## The mistake worth keeping

The first deactivation run read **200** and looked like a refutation of PS-24. The harness caused
it: the probe had called `/api/auth/session`. That is the same trap
`docs/reviews/2026-08-18-auth-session-boundaries.md` recorded from the opposite side, where a probe
that dropped the rotated cookie made revocation look like it worked. **A session-staleness probe has
to reproduce exactly the requests the app makes, no more and no fewer.** Nothing was filed from the
bad run.

## Environment notes for the next local session

- **Port 5433 on this machine belongs to a different project's Postgres.** TrainingAI's dev database
  runs in its own container, `trainingai-dev-postgres`, on **5434**. Pass
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/trainingai_dev` and
  **`DATABASE_SSL=false`** explicitly. Both `DATABASE_URL`s in `.env.local` point at Railway, and
  `.env.local` sets `DATABASE_SSL=true`, which leaks through if the shell merely unsets it.
- **`pnpm build` does not run under Windows `cmd`** (`NODE_OPTIONS=…` prefix). Run
  `node scripts/build-rollup-worker.mjs` then `next build` with `NODE_OPTIONS` exported.
- Stopping a background `next dev` leaves its node child holding :3000. Kill it by PID.

## Not exercised

The device, production, a real Google sign-in or calendar write, and the production CSP header.
