// Vitest config used ONLY by `scripts/ownership-mutation-sweep/index.mjs`. Never picked up by
// `pnpm test` (it is not the root config) and never run in CI.
//
// It applies one ownership mutation at TRANSFORM time: the source file on disk is never written,
// so there is nothing to restore and no way for a mutated predicate to be committed. The target
// comes from the environment:
//
//   OWNERSHIP_MUTATION_FILE   repo-relative path, e.g. lib/data/postgres/slices/nutrition.ts
//   OWNERSHIP_MUTATION_INDEX  predicate index within that file, or `all`
//   OWNERSHIP_MUTATION_MARKER file the plugin writes once the mutation is applied — the driver
//                             refuses to count a green run as a survivor unless it exists, so a
//                             mutation that silently failed to apply cannot read as "not covered"
import path from 'node:path'
import fs from 'node:fs'
import { defineConfig } from 'vitest/config'
import { REPO_ROOT, TARGET_FILES, mutate } from './predicates.mjs'

const file = process.env.OWNERSHIP_MUTATION_FILE
const rawIndex = process.env.OWNERSHIP_MUTATION_INDEX
const marker = process.env.OWNERSHIP_MUTATION_MARKER
// `*` (with index `all`) neutralises every predicate in every target file at once.
const targets = !file ? new Set()
  : new Set((file === '*' ? TARGET_FILES : [file]).map((f) => path.resolve(REPO_ROOT, f)))
const which = rawIndex === 'all' ? 'all' : Number(rawIndex)

const REAL_CONSTANTS_DIR = path.resolve(REPO_ROOT, 'lib/oura-models/constants')
const CONSTANTS_DIR = fs.existsSync(path.join(REAL_CONSTANTS_DIR, 'MANIFEST.json'))
  ? REAL_CONSTANTS_DIR
  : path.resolve(REPO_ROOT, 'lib/oura-models/__fixtures__/constants')

const ownershipMutation = {
  name: 'ownership-mutation',
  enforce: 'pre',
  transform(code, id) {
    const resolved = path.resolve(id.split('?')[0])
    if (!targets.has(resolved)) return null
    const out = mutate(code, which)
    if (out === null) {
      if (file === '*') return null // a target file with no predicates at all
      throw new Error(`ownership-mutation: no predicate ${rawIndex} in ${file}`)
    }
    if (marker) fs.appendFileSync(marker, `${path.relative(REPO_ROOT, resolved)}#${rawIndex}\n`)
    return { code: out, map: null }
  },
}

export default defineConfig({
  root: REPO_ROOT,
  plugins: [ownershipMutation],
  resolve: { alias: { '@': REPO_ROOT } },
  test: {
    environment: 'node',
    env: { OURA_CONSTANTS_DIR: CONSTANTS_DIR },
    setupFiles: [path.join(REPO_ROOT, 'vitest.setup.ts')],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
