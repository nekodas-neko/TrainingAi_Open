# The web-push stack is gone (Q-285)

**Branch:** `chore/remove-web-push` · **Lane A** · migrations 214, 215 · **data-dropping**

## The decision was the owner's, and it was taken with the count in hand

`push_subscriptions` held **0 rows** on 2026-08-15 and still 0 rows when re-measured eight days
later. `sendPushToUser` had exactly one caller in the whole codebase: its own test route. The owner
chose deletion over wiring on 2026-08-24, after Q-286 — the consumer that might have justified
keeping it — turned out to be already delivered by native local notifications, which never touch a
service worker.

## What went

`lib/push.ts`, `lib/push-client.ts`, both `/api/push/*` routes, their tests, the settings toggle and
its test-send button, the `web-push` and `@types/web-push` dependencies, the `push_subscriptions`
table, and the service worker's `push` and `notificationclick` handlers.

**The rest of the service worker stays**, and that is deliberate: it is the APK's offline cold-start,
which CLAUDE.md is explicit about not removing. Only the two web-push listeners went, and
`notificationclick` was only ever reachable from a notification the `push` handler had shown.

## The migration, and why it is two files

**214 drops the view by name, then the table.** The `claude_ro` view depends on the table, so
something had to give first. **Not CASCADE**: cascade takes whatever else happens to depend on the
table, and the entire point of writing a destructive migration down is that its blast radius is on
the page. **215 regenerates the whole `claude_ro` schema** (86 views → 85, 10 withheld columns → 7),
which is how every claude_ro migration works — a new number rather than an edit to 213, because
`ensureSchema` tracks by filename and an edited applied file is skipped forever.

**Why this drop is safe, stated so it is not generalised:** the table is empty in production and
cannot refill, because the subscribe route and the client that called it are deleted in the same
change.

## The check the entry asked for, which I could not make

The entry wanted `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_EMAIL` checked in Railway — not to
change the decision, but so this commit could say whether the stack was ever live. **I could not
make that check**: the sandbox cannot read Railway's environment, and the one endpoint that would
reveal it (`GET /api/push/subscribe`) is auth-gated. It does not change the outcome either way, since
`sendPushToUser` had no non-test caller whether or not VAPID was configured — but the question is
recorded as unanswered rather than guessed at.

## Verification

- Full suite: **581 files, 4763 tests, all passing.** The two long-standing `qrcode` failures are
  also gone — `pnpm remove` reinstalled the workspace and restored the missing package.
- `claude-ro-readonly-role.test.ts` — 21 pass (was 23; the two dropped cases probed
  `push_subscriptions` columns that no longer exist). Its table/view parity check is what actually
  generalises and it still holds.
- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Both migrations applied against the real local Postgres, in order, from the migration runner.

## Not exercised

**Nothing was seen on device.** The settings screen lost a row, and the service worker changed —
the SW in particular is the APK's offline cold-start, so it is worth a launch-offline check on the
next device pass even though nothing in the caching path was touched.

**The `ta_pref_push_enabled` localStorage key is left behind** on any device that ever toggled it.
Nothing reads it now; clearing it would need a device-side migration for no benefit.
