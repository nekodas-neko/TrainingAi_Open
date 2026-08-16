## 2026-08-08 — `fix/offline-write-path-gaps` — Q-123 (b)+(c): the review sheet saves locally, and stops filing activities under the device's day

Closes **Q-123** (review [§3.1–§3.3](../../reviews/2026-08-07-full-app-review.md)). Item (a) — the
outbox's `complete_workout` branch running the same HR-attribution pipeline as the web route —
shipped in #1142. The two remaining items were both in
`components/activity/exercise-review-sheet.tsx` and were explicitly left in the entry "to whoever
owns `components/`". Both are done, so the entry is **removed**.

### (b) The auto-detected walk/run sheet saved server-only

It did a bare `POST /api/activity-logs` with no `getLocalStore` and no `queueMutation` anywhere in
the file, while **both** sibling activity-save surfaces (`done-activity-screen.tsx`,
`walk-summary.tsx`) do local+outbox. So the one save path the app *initiates itself* — "we detected a
walk, save it?" — could not save at all offline, and even online the activity was absent from every
local-first read until the next pull.

Now copies `done-activity-screen.tsx`'s shape: `store.upsertActivityLog` + `store.queueMutation`
(payload through `omitNullFields`, since the route's Zod fields are `.optional()` and reject `null`)
+ `pushMutations`, with the existing API call kept as the web fallback behind a `savedLocally` guard.
The component gained a `userId?` prop, threaded from `session-select-content.tsx` — its two siblings
already took one.

### (c) A device-local date was being written into the database

`:104` built the day key from `getFullYear()/getMonth()/getDate()`. **This is persisted data, not
display**: on a device outside Brisbane the activity is filed under the wrong calendar day and no
later fix can recover which day was meant. Now `toAestDay(new Date(session.startMs))` — the day the
session *started*, in the user's timezone, not "today". The display half at `:205` rendered a
device-local date beside a correctly-zoned `formatTimeOfDay()`; it now uses
`formatDayShort(toAestDay(…))` so both halves of the line agree.

`exercise-review-sheet.tsx` came off the `check-timezone-rendering.js` GRANDFATHERED list as a
result — the ratchet caught it and failed the build until it was removed. **10 sites remain.**

### Sibling sweep — a finding the backlog did not name

Fixing the date key exposed the same bug one field over: `start_time` / `end_time` are also
**persisted** clock strings, and **four** sites built them from the device's own `getHours()` —
`exercise-review-sheet.tsx`, `done-activity-screen.tsx`, `walk-summary.tsx`, and
`lib/health-connect-sync.ts`, each with its own private copy of the same three-line helper. A phone
set to UTC stored a 9 pm Brisbane walk as `11:00`.

One `msToHHMMInTz(at, tz)` in `packages/shared/src/date-utils.ts` now replaces all four local copies.
No migration is needed for existing rows: the owner's device is in Brisbane, so device-local and
user-local already agreed for every row written so far — the fix changes behaviour only for a device
outside that zone, which is exactly the case that was broken.

### Verification

- `tsc --noEmit` clean · `eslint` 0 errors · all eight custom-rule scripts pass (after the
  grandfathered-list removal above).

### Not exercised

**No device run, and the offline path is the part that needs one.** `getLocalStore` returns `null` in
the web/dev sandbox, so `pnpm dev` exercises only the API fallback branch — the local-store write,
the outbox row, and `pushMutations` are verified by matching them field-for-field against the
`done-activity-screen.tsx` reference and by type-checking against `upsertActivityLog`'s signature,
**not by observing a row land in native SQLite**. The auto-detection sheet additionally needs a
detected walk to appear, which needs the ring or phone motion pipeline. On-device is the authoritative
check for both halves of (b).

The timezone fix (c) is deterministic and covered by reading the helper, but was **not** verified by
running with the device clock set outside Brisbane.
