# 2026-08-15 — the admin console splits by audience (Q-234)

**Branch:** `claude/ia-cluster-app-shell` · **Version:** v1.313.0
**Plan:** [`2026-08-14-more-tab-information-architecture.md`](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md) §4, step 5 — last of the build order, because it needed `/more/settings` to exist.

`/admin` had nine tabs, three sub-consoles reachable only from inside the Tools tab, and a nested
"Additional tools" collapsible inside that. Two audiences stacked in one console:

- **User administration** — users, invites, feedback. Rare, deliberate, legitimately "admin".
- **Developer diagnostics** — BLE debug, cadence calibration, device data capture, HR backfills,
  time audit, error log, AI usage, model assets. Debug tools for the owner's own device, used far
  more often, and the deepest-buried things in the app.

Now: `/admin` keeps user administration; diagnostics are **Settings → Developer**, admin-only.

## Where each thing went

| Was | Now |
|---|---|
| `users`, `invites`, `feedback` | `/admin` — unchanged |
| `exercises`, `activities` | `/admin` — see below |
| `tools` tab (3 console buttons + time audit + program export + 4 collapsed cards) | `/more/settings/developer` |
| `errors`, `ai-usage`, `day-review` tabs | `/more/settings/developer/{errors,ai-usage,day-review}` |

**`exercises` and `activities` stayed on `/admin`, and the plan does not name them.** They are the
exercise library and activity-type catalogue — content every user sees, edited rarely and
deliberately. That is content administration, not device diagnostics, so they sit with the audience
they match rather than being moved because they were adjacent to things that moved.

The three sub-consoles are **rows** now, not buttons inside a tab inside a console — which is what
§4 asked for and what Q-239 identified as the only genuinely misplaced single-entry screens.

`admin-content.tsx`: 476 → **395** lines, nine tabs → five.

## The gate

`/more/settings` resolves `isAdminUser()` server-side and passes it down; the Developer group renders
only for an admin, and `/more/settings/developer` plus all three sub-routes re-check it themselves
and `redirect('/')` otherwise. That mirrors `/admin/page.tsx` exactly, including its reasoning: this
is a **render gate**, and every action underneath still re-checks authoritatively through
`requireAdmin`, which ignores the JWT flag and hits the DB.

Worth knowing for anyone testing this: `isAdminUser(id, flag)` **returns the JWT flag whenever it is
a boolean** and only falls back to the DB when it is undefined. So flipping `users.is_admin` does
nothing until a fresh login stamps a new token.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings) · `pnpm build` (all four developer routes in the
table) · **`pnpm check:rules` — Ran 35 of 35** · `check-component-size` + `check-hex-literals` clean ·
full suite **471 files / 3,903 tests green**.

`pnpm dev` at 412×915, **both sides of the gate exercised** by flipping the local test user's
`is_admin` and re-logging in each time (reverted afterwards — it is `false` again):

- **Non-admin:** Settings shows **no** Developer row, and `/more/settings/developer` redirects to `/`.
- **Admin:** Settings shows the Developer row → *DEVICE CONSOLES* (Oura BLE debug · Cadence
  calibration · Device data capture) and *DIAGNOSTICS* (Error log · AI usage · Day review), followed
  by the time audit, program export and the four former "Additional tools" cards.
- All three sub-routes render their real content: the error log ("No errors recorded"), AI usage
  (3 calls, 865 tokens, double-trip detection), the day-review audit.
- `/admin` now shows exactly **Users · Invites · Exercises · Activities · Feedback**.
- Zero console errors throughout.

**⚠️ Not device-verified.** Four more navless takeover screens on `pb-safe-action-lg`; and the three
device consoles behind these rows are APK-only by nature — `/admin/oura-ble` in particular cannot do
anything in a browser. This change only moves how they are reached, but "reached" is the half the
sandbox can show.
