# 2026-09-27 — RV-208 ① and ②: one clock form across four surfaces, and a load formatter for Lane B

## ① Time of day — three forms, not two

The entry said `formatTimeOfDay` emits `6:40am` and one route bypasses it. Measured, both halves
were off:

| form | source | surfaces |
|---|---|---|
| `6:40 AM` | `app/api/day-timeline/route.ts`, its own `h:mm a` | Home's timeline |
| `6:40am` | `fmtAest` in `date-utils.ts`, its own `h:mmaaa` | Health → Day (via `/api/day-log`), Body Battery axis |
| `6:40 am` | `formatTimeOfDay`, the documented "one place" | the activity list and the rest |

The route now calls `formatTimeOfDay`, and `fmtAest` delegates to it, so no caller of `fmtAest`
needed an edit. `formatInTimeZone` left the route's imports. Nothing parses these strings: the two
consumers of `workoutDurationsById` show them, and `MealCard` splits its subtitle on `' · '` only.

**Still their own form, filed on RV-208 for Lane B:** `sleep-verdict-copy.ts`'s `formatClock`
(`11:10pm`) and `sleep-timing-trend-utils.ts`'s `clockLabel` (`6:30 AM`). Both format
minutes-of-day, not an instant, so a straight swap does not apply.

## ② `formatLoadKg`

`68 kg` / `67.5 kg` / `71.25 kg`: two decimals, trimmed. One decimal would round a 1.25 kg plate
step to `71.3`. `formatKg` also gains `trim`, off by default, because body-weight columns want the
padding. The six lift sites the entry lists are Lane B's and are left for them.

## Verification

- A new route test pins `5:00 pm` / `6:00 pm`; `day-log-duration-session-identity` now expects
  `9:00 am`; four new `formatLoadKg` cases.
- Mutants: `fmtAest` back on its own format, the timeline uppercased, `trim` ignored, and the load at
  one decimal were all killed. The control (template coercion in place of `String(Number())`)
  survived.
- `pnpm dev` at 412 px: Home's timeline renders `5:00 pm`, `9:00 am` and `4:00 am – 4:55 am`, each
  on one line in its row.

## Not exercised

The Body Battery card's axis labels: the seed has no Body Battery data, so the card showed "No data
yet". The device.
