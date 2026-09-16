# Health Connect reads three record types it cannot parse (TN-44's premise, corrected)

**2026-09-16 · Lane A · source read against the pinned plugin, with a production cross-check.**

TN-44 says Health Connect defines ten record types our pillars want and we do not read, and files the
work as an addition to `HC_SYNC_READ_TYPES`. **Both halves needed correcting**, and the correction
came from doing what CLAUDE.md's external-API rule demands — reading the pinned plugin's own source
rather than the platform's docs.

## 1. The platform is not the plugin

Health Connect the *platform* does define `SkinTemperatureRecord`, `RespiratoryRateRecord`,
`Vo2MaxRecord` and the rest. **The pinned plugin cannot convert them.**
`@devmaxime/capacitor-health-connect@1.1.0` (patched locally) has a `RecordConverter` with exactly
**seven** `is XRecord ->` branches:

`ExerciseSession` · `Steps` · `Weight` · `SleepSession` · `RestingHeartRate` · `BodyFat` · `Nutrition`

Its fallback is `else -> record.toString()`. So an unhandled record does not fail — it comes back as
a **Kotlin `toString()` blob**, and every field access on the JS side is `undefined`.

The read path itself is generic: `readRecords` resolves the type through
`androidx.health.connect.client.impl.converters.datatype.RECORDS_TYPE_NAME_MAP`, the **SDK's** map,
so any SDK type name is permissible and readable. **Conversion is the wall, not permission.** That is
why this is not a list edit: each new type needs a `RecordConverter` branch, which is Kotlin, which
needs a new APK.

## 2. Three types we ALREADY read fall through that hole

`HC_SYNC_READ_TYPES` asks for eleven types. Three are read via `readRecords` and have **no converter
branch**:

| type | read at | converter branch | result |
|---|---|---|---|
| `HeartRateVariabilityRmssd` | `health-connect-sync.ts:343` | **none** | `r.heartRateVariabilityMillis` is `undefined` |
| `OxygenSaturation` | `:365` | **none** | `r.percentage` is `undefined` |
| `HeartRateSeries` | `:154` (enrich path) | **none** | `r.samples` is `undefined` |

Each sits inside `try { … } catch { /* ignore */ }`, and each feeds a date filter that silently drops
everything: `new Date(undefined)` is an Invalid Date, `getHours()` is `NaN`, and `NaN >= 0 && NaN < 8`
is false. **No error, no log, no value.**

`TotalCaloriesBurned` and `Distance` are fine — they go through `aggregateRecords`, which has its own
`when (type)` in the Kotlin and never touches `RecordConverter`.

**The tell is greppable:** every broken call carries `as any` on its `type`. The cast is what let a
type past the plugin's `RecordType` union. Two other `as any` calls (`BodyFat`, `Nutrition`) are
*fine*, because the repo's own patch added those to **both** the TS union and the Kotlin. The patch
added `HeartRateVariabilitySdnn` and `OxygenSaturation` to the union and **not** to the Kotlin — so
`as any` marks exactly the boundary where the type list outran the converter, and in three cases it
never caught up.

## 3. The production cross-check — consistent, and confounded

The owner's `body_metrics` rows that Health Connect touched, 2026-06-24 → 2026-08-01 (n = 17):

| field | rows credited to `health_connect` |
|---|---:|
| steps | **15** |
| weight | **11** |
| resting heart rate | **0** |
| HRV | **0** |
| SpO₂ | **0** |

HRV and SpO₂ read zero, as predicted. **But this does not prove the finding**, and the reason matters:
`source_map` records only the *winning* source per field under the ranked merge, and the Oura ring
outranks Health Connect for exactly these fields. A zero here is equally consistent with "Health
Connect produced a value and lost the merge". Resting heart rate reading 0 while its converter branch
**does** exist is the proof of that confound sitting in the same table.

**So the source read is the evidence and the production numbers are corroboration only.** Nothing here
was observed on a device, and this repo's own rule — prove a non-null value lands in the column — is
not satisfiable from a sandbox for a Health Connect path.

## 4. Two defects on the same file, fixed in this PR

- **The overnight windows read the DEVICE's clock.** `d.getHours()` at `:347` and `:369`, and
  `toLocalDate` resolving `Intl.DateTimeFormat().resolvedOptions().timeZone`. That is the class
  CLAUDE.md bans, invisible until the phone leaves the zone the data was recorded in — on a phone set
  to New York a Brisbane night lands on the previous day. Both now take the user's timezone.
  `toLocalDate` was also a second implementation of `toAestDay`, which has taken a `tz` all along; it
  delegates now.
- **The `hrvMs` field comment said SDNN** while the code reads `HeartRateVariabilityRmssd`. The code
  is right. Worth fixing because this repo has shipped that exact mix-up once.

## What this does NOT fix

**The three unparseable types still return blobs.** Fixing them means adding `RecordConverter`
branches — Kotlin, in the local patch — plus a new APK and an on-device permission grant. Filed as
its own entry. Threading the user's timezone from the *caller* (`components/health-connect-provider.tsx`,
which has the session) is Lane B and filed separately; until it lands, the parameter defaults to
`DEFAULT_TZ`, which is correct for the owner and is the repo's documented default-parameter pattern.

## Not exercised

No device, no APK, no Health Connect permission grant, no Android. Every claim above is a source read
of the pinned plugin plus a row-scoped production query (`claude_ro` shows the owner's rows only).
Nothing here was observed working or failing on hardware.
