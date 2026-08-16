// Node-only server-boot work, imported (for its side effect) from instrumentation.ts solely under
// the `NEXT_RUNTIME === 'nodejs'` guard, so it never lands in an edge/browser bundle.
//
// Warm the DB schema-readiness check once, at process start, so the first user request after a
// deploy doesn't race the ~130-file migration sweep. `ensureSchema()` runs that sweep on the pool
// the first time it's called; on a cold post-deploy process every early request would otherwise
// block on it while it holds a connection — and the home/health screens fire ~15 aggregate GETs at
// once, so requests queue past the client's abort threshold and 499 ("some sections won't load /
// Sync failed", right after a deploy). Running it here moves the sweep off the first-request path.
//
// Imported straight from the low-level client (NOT getRepository() in @/lib/data): the latter pulls
// in the Drizzle adapter → onnxruntime-node native addon, which webpack can't bundle. client.ts is
// dependency-light (pg + schema) and ensureSchema() is internally memoised, so the first
// getRepository() at request time finds the schema already applied — a no-op.
//
// Best-effort: getRepository()/ensureReady() already self-heals a failed ensureSchema (clears its
// cached promise and retries on the next call), so a boot-time failure here is harmless.
async function warmSchema(): Promise<void> {
  if (!process.env.DATABASE_URL) return
  try {
    const { ensureSchema } = await import('@/lib/data/postgres/client')
    await ensureSchema()
  } catch (err) {
    console.error('[instrumentation] schema warm-up failed (first request will retry):', String(err).slice(0, 300))
  }
}

// Model-asset presence. The `inference/` loaders are infallible by contract — a missing `.onnx`
// makes `getSession` return null and every caller falls back — so a deploy with no model files at
// all looks perfectly healthy while silently serving degraded sleep staging and daily steps. This
// says so at boot instead.
//
// **It now asks the bucket, and it now throws** (Q-49 A4b). Both halves of that changed in the same
// commit as the deletion, and neither could have changed before it:
//
//   - The directory it used to stat no longer holds the models, so a disk check would fail every
//     boot for a reason that is expected rather than wrong.
//   - Failing loudly was the only sane choice while the files were committed, because the check
//     could then only ever fire on a false positive. Now object storage is the sole source, a
//     failed read is a real and otherwise-invisible outcome, and a process that keeps serving
//     through it serves degraded sleep staging and steps to a user who is told nothing.
//
// `unreachable` is treated exactly like `incomplete`, deliberately: whatever the cause, this
// process cannot get the models, and letting it come up would put the difference between "the
// bucket is empty" and "the credentials are wrong" in front of a lifter as a silently worse
// hypnogram. The distinction is preserved in the message for whoever reads the deploy log.
async function checkModelAssets(): Promise<void> {
  let summary: string
  try {
    const { reportModelBucketAssets } = await import('@/lib/oura-models/bucket-report')
    const report = await reportModelBucketAssets()
    if (report.verdict === 'complete') {
      console.info(`[instrumentation] model assets: ${report.files.length} file(s) in object storage`)
      return
    }
    summary = report.summary
  } catch (err) {
    // A check that cannot run is not a check that passed. It routes to the same place as a failed
    // one rather than being swallowed, which is what the old `catch` + `console.error` did.
    summary = `the model-asset check could not run: ${String(err).slice(0, 300)}`
  }
  fatalOrLoud(`MODEL ASSETS UNAVAILABLE — ${summary}`)
}

/**
 * Fail the boot in production; say so and carry on anywhere else.
 *
 * The gate is `NODE_ENV`, not "are the storage credentials set", and that is the load-bearing
 * detail. Gating on credentials would skip the check in exactly the case it exists to catch — a
 * production deploy that lost its storage variables — which is the fail-open shape CLAUDE.md's
 * security rule forbids. `NODE_ENV` cannot be wrong in the direction that matters: Railway sets it,
 * and nothing else does.
 *
 * The non-production half is not a softening of the rule, it is what keeps `pnpm dev` usable. A
 * session sandbox holds placeholder storage credentials that reject every request, and the vendored
 * copies are no longer in the tree to fall back on, so throwing here would make the dev server —
 * the merge gate CLAUDE.md requires every change to pass through — impossible to start at all.
 * What a developer gets instead is a degraded app and a line saying which half is degraded.
 */
function fatalOrLoud(message: string): void {
  if (process.env.NODE_ENV === 'production') throw new Error(`[instrumentation] ${message}`)
  console.error(`[instrumentation] ${message} (non-production: continuing degraded)`)
}

// Admin bootstrap. Migration 006 used to grant admin with the owner's literal email baked into the
// SQL, which is both a personal detail the public repo should not carry and the wrong mechanism:
// CLAUDE.md's own rule is that a migration must never resolve a row by name at run time, because the
// row may not exist yet for a user who has not logged in — a migration runs once and cannot notice
// later. A boot-time grant has no such problem. It re-runs every deploy, so it lands whenever the
// row appears, and it is parameterised rather than interpolated.
//
// This is a BOOTSTRAP, not an authorization mechanism: `users.is_admin` remains the only source of
// truth, and every gate (`requireAdmin`, the JWT claim, the admin tab) still reads it from the DB.
// Unset the var and this does nothing at all — no default, no fallback email, no implicit grant.
async function bootstrapAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL
  if (!email || !process.env.DATABASE_URL) return
  try {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { rowCount } = await getPool().query(
      'UPDATE users SET is_admin = true WHERE email = $1 AND is_admin = false',
      [email],
    )
    if (rowCount) console.info('[instrumentation] admin granted to ADMIN_EMAIL')
  } catch (err) {
    console.error('[instrumentation] admin bootstrap failed:', String(err).slice(0, 300))
  }
}

/**
 * Put the model constants where the synchronous loader can read them, before anything reads it.
 *
 * AWAITED, unlike its neighbours, and that is the whole reason it is written differently: the
 * loader is synchronous and throws when a file is absent, so a fire-and-forget download would race
 * the first request and fail it. `register()` is awaited by Next, so awaiting here genuinely blocks
 * boot rather than merely looking like it does.
 *
 * The repo copy is gone as of Q-49 A4b, so in production this is the download and nothing else. The
 * tree branch inside `ensureConstantsAvailable()` stays for a machine that still has the vendor's
 * files — it is not dead code, it is the local-development path.
 *
 * **This deploy is the download path's first real execution anywhere.** It could not be exercised
 * earlier: while the files were committed every run returned at the tree branch, and no session
 * sandbox can authenticate to the bucket. That is precisely why the failure is fatal now rather
 * than later — an untested mechanism that fails quietly would serve a half-populated directory,
 * and the loader throws per-request on whatever it is missing, which reads as a scatter of
 * unrelated 500s rather than as one boot that should not have happened.
 */
async function deliverConstants(): Promise<void> {
  let detail: string
  try {
    const { ensureConstantsAvailable } = await import('@/lib/oura-models/constants-delivery')
    const result = await ensureConstantsAvailable()
    if (result.dir) {
      process.env.OURA_CONSTANTS_DIR = result.dir
      console.info(`[instrumentation] model constants: ${result.source} — ${result.detail}`)
      return
    }
    detail = result.detail
  } catch (err) {
    detail = `delivery failed to run: ${String(err).slice(0, 300)}`
  }
  fatalOrLoud(`MODEL CONSTANTS UNAVAILABLE — ${detail}`)
}

// Both awaited, and that is what makes them gates rather than reports: `register()` is awaited by
// Next, so a throw in here fails the boot. A `void` call would surface the same error as an
// unhandled rejection while the process carried on serving.
await deliverConstants()
await checkModelAssets()

void warmSchema()
void bootstrapAdmin()

// Marks this file as a module (it has no other imports/exports) so instrumentation.ts can
// `await import('./instrumentation-node')` it for its side effect.
export {}
