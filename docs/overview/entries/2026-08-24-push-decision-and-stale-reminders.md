# The push decision, and the reminder entry it was waiting on turned out to be shipped (Q-285, Q-286)

**Branch:** `docs/push-decision-and-stale-reminders` · **Lane B** · docs-only

## Q-286 — removed, both halves already work

The entry: *"a user can enable a supplement reminder that can never fire."* Its evidence was that
`supplements.reminder_enabled` / `reminder_time` are exposed as a real control, persisted, synced,
and **"read by nothing that fires a notification."**

Nothing about that holds on `main`:

- **`lib/supplement-reminders.ts`** exists — `computeSupplementReminderActions()` (pure, so it is
  unit-testable), `reconcileSupplementReminders()` and `cancelSupplementReminder()`, notification
  ids 8500–8699, following `lib/meal-reminders.ts`'s shape exactly.
- **The channel is created**: `capacitor-native-init.tsx:164`, `SUPPLEMENT_REMINDERS_CHANNEL`.
- **It is reconciled on app open and on resume**: `sync-provider.tsx:303`, fed from
  `/api/supplements`, behind `Capacitor.isNativePlatform()`.
- **Every write site cancels**: 8 call sites across `manage-supplements-sheet.tsx` and
  `supplements-section.tsx`.
- **12 unit tests, all passing** (`lib/__tests__/supplement-reminders.test.ts`), run here.
- It is journaled in `docs/overview/history-recent.md:507`.

**The entry's "two independent reasons it cannot work" never applied.** Both were about a *server*
scheduler — no cron layer, and a dead web-push transport. The app does not use either for reminders:
it schedules on the device with `@capacitor/local-notifications`, which is what the entry's own
option (b) proposed and what four other features already do (meal reminders, the end-of-day nudge,
day-review reminders, walk cues).

**The sibling it asks about does not exist.** *"`program_sessions.reminder_enabled` has the same
shape — check whether it has a UI toggle too."* There is no such column. Against the live schema, the
reminder columns are on `meal_types`, `schedules` and `supplements` — and all three have a working
local-notification path (`meal-reminders.ts`, `reconcileWorkoutReminder`, `supplement-reminders.ts`).
The schedule-level toggle is `config-screen.tsx:422`, reconciled at `sync-provider.tsx:271`.

## Q-285 — owner chose (b), delete; re-laned to A

Asked with the count in hand: **0 subscriptions** (unchanged over 8 days), one caller of
`sendPushToUser` and it is the test route, and the native Android notifications are a separate stack
that works.

**Option (a) — wire it — is off the table on its own merits, not just by preference.** Its whole
premise was that Q-286 is a shipped-and-stranded consumer waiting for a transport. Q-286 is
delivered, by local notifications. Wiring web push would build a second transport for a finished job.

**Re-laned to A.** The deletion is `lib/push.ts`, both `app/api/push/*` routes and the
`push_subscriptions` table — `app/api/**` plus storage. The Lane B half (`lib/push-client.ts`, the
toggle at `settings-panel.tsx:78`) is small and should ride with it rather than land alone and leave
a control pointing at a route that is about to go.

Left on the entry for whoever takes it: check whether the VAPID vars are set in Railway before the
delete lands. Not to change the decision — to know whether the stack was ever live, since
`sendPushToUser` returns silently when they are unset and an unconfigured deployment looks identical
to a working one with no subscribers.

## Not exercised

**No reminder was observed firing on the device.** Everything above is the wiring being present,
complete and unit-tested, plus a journal entry recording it shipping. Whether a supplement reminder
actually arrives on the S25 at its set time is unverified here and cannot be verified from a browser
— the whole path is behind `Capacitor.isNativePlatform()`. Worth one look, and it is the only claim
in this entry's removal that rests on reading rather than running.

No code changed in this PR.
