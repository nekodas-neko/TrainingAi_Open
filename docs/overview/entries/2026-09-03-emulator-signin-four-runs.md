# 2026-09-03 — four real emulator runs: three defects fixed, one question left (Q-250)

**Branch:** `feat/ci-android-emulator` · the job is still `workflow_dispatch`-only, deliberately.

Q-250's job has had steps 1–14 passing since August and could never pass the fifteenth:
`getLocalStore(userId)` needs a signed-in user, so the app sits on the sign-in screen, no local
SQLite database is created, and the smoke script polls for a file that cannot appear. The entry's
plan was Maestro. That plan was right; almost everything else about the diagnosis was wrong, and only
running it four times on a real runner showed why.

| run | outcome | established |
|---|---|---|
| 1 (11 m) | emulator: *"Sign in with email" is not visible* | **A red herring.** The server was dead — `next start` sets `NODE_ENV=production`, `instrumentation-node.ts` hard-fails there on missing model constants, every request 500'd. Maestro read an error page correctly. |
| 2 (6.5 m) | **Start the server**, 120 s probe timeout | The probe fix worked — the failure moved to its cause. A **second** gate then fired. |
| 3 (12.5 m) | server boots in **8 s**; APK, Maestro, KVM pass; emulator fails | The dev-server switch cleared the boot problem outright. |
| 4 (13 m) | routes warm in **11 s**; emulator fails after **180 s** | **Killed the timing hypothesis.** Compilation was never the cost. |

## Three defects fixed, none of them the one expected

**1. The readiness probe passed on HTTP 500.** It printed *"server up (HTTP 500)"* and let the job
run on to fail eight minutes later inside the emulator. That single line is why run 1 presented as a
UI-automation problem. **A probe that passes on 5xx is worse than no probe** — it moves the error away
from its cause. This is the most transferable thing in this entry.

**2. Two boot gates are production-hard and only one has a local substitute.** Model constants can be
satisfied honestly from committed synthetic fixtures. `checkModelAssets` asks object storage and has
**no tree fallback at all**, so a production-mode server can never boot on a bucket-less runner.

⚠ **Neither gate was relaxed and neither should be.** They key on `NODE_ENV` rather than on whether
credentials exist, precisely so a production deploy that lost its storage variables fails instead of
quietly serving degraded sleep staging. An escape hatch in `fatalOrLoud` is that same fail-open
shape; CI bucket credentials are an owner decision about secrets. The job serves from **`pnpm dev`**
instead, which sidesteps both without touching either — and nothing it asserts depends on production
serving, since local SQLite migrations behave identically.

**3. `next dev` compiles on first request, and the probe only asked for `/`** — which 307s to
`/sign-in` *without* compiling it, so the emulator paid that cost inside a UI wait. Warmed on the
host now. It measured **11 s**, not the 120 s guessed: the fix is still correct, and measuring it is
what disproved my own hypothesis.

## What is left, as two candidates rather than a conclusion

- **(a) Maestro may not read text inside a WebView at all.** If so the fix is
  `setWebContentsDebuggingEnabled(true)` on the debug build plus Maestro's web selectors — not a
  longer timeout.
- **(b) The emulator may not be reaching the host.** The smoke script's reachability check is
  **advisory**: it prints `WARN: could not confirm host reachability … continuing` and has never once
  confirmed the hop. An unreachable `10.0.2.2:3000` shows an error page and no form, which at this
  level of evidence is indistinguishable from (a). **Settle (b) first — it is far cheaper**: make
  that check assert rather than warn.

## Why it stopped at four runs

The evidence needed next is in the `emulator-diagnostics` artifact — `logcat.txt`, the Maestro report
and Maestro's own screenshot. **A session with no artifact download cannot open it.** That, not the
emulator, is the real ceiling here, and it is worth knowing before someone budgets another afternoon.

## Honest state

The job **does not pass** and the `pull_request` trigger stays commented out. A permanently-red check
trains people to ignore the signal, which is why it was disabled originally, and nothing here earns
turning it back on. What did change: the server now boots, the APK builds and installs, Maestro runs,
and the failure is one narrow question instead of four stacked ones.
