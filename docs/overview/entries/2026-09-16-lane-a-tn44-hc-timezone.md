# 2026-09-16 — Lane A · TN-44: the Health Connect timezone bug, and the wall behind the entry

**Branch:** `lane-a/tn44-hc-timezone-and-converter` · **v1.457.3**

TN-44 asked for ten Health Connect record types to be added to `HC_SYNC_READ_TYPES`. Reading the
pinned plugin's source first — as CLAUDE.md's external-API rule demands — turned that into a
different, larger finding, and the list edit turned out to be the one thing that would not have
worked.

Full read: [`docs/reviews/2026-09-16-health-connect-record-converter-gap.md`](../../reviews/2026-09-16-health-connect-record-converter-gap.md).

## What shipped

**The overnight windows bucket in the user's timezone now.** `d.getHours()` at `:347`/`:369` read the
**device's** clock, and `toLocalDate` resolved `Intl.DateTimeFormat().resolvedOptions().timeZone` —
the class CLAUDE.md bans, invisible until the phone leaves the zone the data was recorded in. On a
phone set to New York a Brisbane night's HRV lands on the previous day, silently.

`toLocalDate` was also a **second implementation of `toAestDay`**, which has taken a `tz` since it was
written. It delegates now rather than keeping a copy.

The stale `hrvMs` *"SDNN"* comment is corrected — the code reads `HeartRateVariabilityRmssd`, and the
code is right. Worth fixing because this repo has shipped that exact mix-up once.

## What the source read found instead

**The pinned plugin cannot convert most of what TN-44 asks for.** `RecordConverter` has exactly seven
`is XRecord ->` branches and falls back to `else -> record.toString()`. The read path is generic — it
resolves through the SDK's own `RECORDS_TYPE_NAME_MAP` — so **conversion is the wall, not
permission**. Adding a type to the list without a converter branch returns a Kotlin string blob whose
every field reads `undefined`.

**And three types we already ask for are in that hole today:** `HeartRateVariabilityRmssd`,
`OxygenSaturation` and `HeartRateSeries`. Each sits in a `catch { /* ignore */ }` feeding a date
filter that drops everything — `new Date(undefined)` → Invalid Date → `NaN` hour → the window test is
false. No error, no log, no value. Filed as **LA-115** (device-gated: it is Kotlin in the local
patch, so it needs an APK).

**The greppable tell:** every broken call carries `as any` on its `type`. That cast is what let a type
past the plugin's `RecordType` union — and `BodyFat`/`Nutrition` carry it too and are *fine*, because
the repo's own patch added those to **both** the union and the Kotlin. The patch added
`HeartRateVariabilitySdnn` and `OxygenSaturation` to the union **only**. So `as any` marks exactly
where the type list outran the converter.

## The production check, and why it is corroboration rather than proof

The owner's `body_metrics` rows that Health Connect touched (n = 17) credit it with steps 15 and
weight 11, and **HRV 0, SpO₂ 0** — as predicted. **But resting heart rate also reads 0, and its
converter branch exists.** `source_map` records only the *winning* source under the ranked merge and
the ring outranks Health Connect for those fields, so a zero is equally consistent with "HC produced
a value and lost". The confound is sitting in the same table as the result, which is what stops the
zeros being quoted as proof.

## Lane discipline

The timezone now threads through the Lane A library with a `DEFAULT_TZ` default. **The caller is Lane
B** — `components/health-connect-provider.tsx` has the session and should pass
`session.user.timezone` — so that half is filed as **LB-113** rather than reached across the lane
boundary. Until it lands the default is correct for the owner, which is the repo's documented
default-parameter pattern, and LB-113 names the risk that a default nobody overrides is a silent one.

## Verification

- `pnpm test` **924 files / 8773 tests** green (with `DATABASE_URL` set). `pnpm check:rules`
  **75 of 75** — it caught a `Gate:` field written inline on the re-scoped TN-44, which would have
  been silently ignored and left the entry READY. Typecheck and lint clean.
- **Mutation pass, 3 mutants, all killed:** hour back to `getHours()`, date back to the device zone,
  and a 12-hour format token. **Equivalent control** (`'H'` → `'HH'`, which `Number()` parses
  identically) stayed green.
- The new tests use **fixed-offset zones** (`Etc/GMT-10`, `Etc/GMT+5`) and an explicit instant, so
  they fire on every CI run rather than only inside the window where the bug shows — the shape
  CLAUDE.md's date-arithmetic rule asks for.

**Not exercised.** No device, no APK, no Android, no Health Connect permission grant. The sync module
only runs under Capacitor (`Capacitor.isNativePlatform()` gates both entry points), so **nothing in
this file was executed** — the tests cover the two extracted pure helpers and nothing else. Every
claim about the plugin is a source read of the pinned version; every production figure is the owner's
rows only (`claude_ro` is row-scoped). Nothing was observed working or failing on hardware.

## The lesson

TN-44's claims about the *platform* were all true. Its conclusion — that this is a list edit — was
wrong, and only reading the pinned plugin's source showed it. That is the third entry this session
whose source claims held and whose conclusion did not, and the second time the answer came from
reading the dependency rather than the docs.
