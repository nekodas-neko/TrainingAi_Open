# 2026-08-19 — `pnpm dev` can render the energy screens again (Q-361)

**Branch:** `fix/sandbox-energy-constants` · **Lane:** Implementation A

## What was wrong

`GET /api/nutrition/energy-balance` and `GET /api/body-metadata` returned **500 in every sandbox
session**, every time:

```
Error: ENOENT: no such file or directory, open
  '.../lib/oura-models/constants/energy-expenditure-features.json'
```

`lib/oura-models/constants/*` is gitignored — it left the tree in the public-repo cut (Q-49) and now
arrives at boot from object storage, which no session can authenticate to. The loader throws by
design (*"a missing constant is a wrong number, not a missing feature"*), which is right in
production and simply means "never present" here.

The cost was not a broken feature but a **broken verification surface**: the Energy card on day
detail, the energy bar on Nutrition and anything else reading those routes rendered nothing at all
locally. Any session that claimed a `pnpm dev` pass on those screens was claiming something it could
not have done.

A second, independent blocker sat behind it: the seeded user had no `date_of_birth`, so
`computeEnergyBalance` had no age and returned a null balance even once the constants were readable.
Both had to go or the fix was worthless.

## The entry's open question, now answered

Q-361 asked — correctly — whether CI hits this, and said to establish it before fixing. **It does
not, and here is each reason separately:**

- **Build** — the constants read moved off module scope to first use (deliberately,
  `workout-energy.ts:31`), so `next build`'s page-data collection never opens the file.
- **Tests** — `vitest.config.ts` already points `OURA_CONSTANTS_DIR` at
  `lib/oura-models/__fixtures__/constants` whenever the real set is absent.
- **E2E** — no spec navigates to either screen (`grep -rl 'energy-balance\|body-metadata' e2e/` is
  empty). Playwright's `webServer` runs `pnpm dev`, so its server had the same defect; nothing ever
  asked it for those routes.

Green in CI, dead locally — exactly the shape that trains sessions to stop believing local runs.

## What shipped

**The fix is smaller than the entry proposed, because the substitute already existed.** Q-361's
preferred option was for `scripts/local-db/setup.sh` to write a labelled stub. That would have been a
*second* fake constants set — hand-written, kept in step with nothing, living in a gitignored path
indistinguishable from the vendor's own files, and only on machines that ran the remote-session hook.

`scripts/generate-test-constants.js` already produces exactly the needed thing and commits it: every
key real, every **number** synthetic, derived from the loader's own file list, and the suite already
runs against it.

- `lib/oura-models/constants-delivery.ts` — `ensureConstantsAvailable()` now wraps the real delivery
  and, **outside production only**, falls back to those committed fixtures. The gate is `NODE_ENV`,
  not "did the bucket answer", for the same reason `instrumentation-node.ts`'s `fatalOrLoud` uses it:
  gating on credentials would substitute invented MET numbers in precisely the case that must fail —
  a production deploy that lost its storage variables. The fallback sits *after* the bucket attempt,
  so a machine with real constants or real credentials is unaffected.
- `instrumentation-node.ts` — the fixtures branch **warns** rather than informs. It is the one source
  whose numbers are wrong on purpose, and a boot line reading like a real delivery is how a session
  comes to quote a sandbox figure as if it meant something.
- `scripts/local-db/seed.sql` — the demo user gets a fixed `date_of_birth` (1993-06-15). Fixed rather
  than derived from `now()`: a moving value would make any energy figure computed from it drift
  between sessions for no reason.
- `lib/oura-models/__tests__/constants-delivery.test.ts` — two cases. One asserts the fallback serves
  the fixtures **and says `SYNTHETIC` in the boot detail**; the other asserts production never
  substitutes them. The second is the fail-closed half and is the point of the `NODE_ENV` gate.

## Verified, not assumed

Measured on `pnpm dev` against the local DB, running the full revert/restore cycle:

| | `/api/nutrition/energy-balance` | `/api/body-metadata` |
|---|---|---|
| `constants-delivery.ts` at `origin/main` | **500** | **500** |
| with the fallback | **200** | **200** |

Same database and same profile on both rows, so the difference is the delivery change alone. The
200 response carries `"missingProfileFields": []`, which is the seed's half — before the
`date_of_birth`, that list named `date of birth` and the balance was null.

Boot line now reads:
`[instrumentation] model constants: fixtures — SYNTHETIC test fixtures — every number is fake. could not list the bucket: SignatureDoesNotMatch (403)`

`seed.sql` was re-applied to a throwaway database built from all 203 migrations to confirm it still
parses and produces the new column.

**Not exercised:** nothing on-device, and nothing in production. This change cannot reach either — the
tree branch wins where the vendor's files exist, and the fixtures branch is unreachable under
`NODE_ENV=production`, which the second test pins.

**One thing worth knowing for the next session:** the numbers those screens now show locally are
**arbitrary**. The MET table is synthetic, so an energy figure from `pnpm dev` verifies *shape and
plumbing* and nothing else. Never quote one as a value.
