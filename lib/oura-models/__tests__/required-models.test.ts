import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { REQUIRED_MODEL_FILES, verifyModelAssets, describeModelAssetReport } from '../required-models'
import modelFiles from '../model-files.json'
import { hasRealConstants } from '../__fixtures__/real-constants'

const ROOT = path.resolve(__dirname, '../../..')
const ONNX_DIR = path.join(ROOT, 'lib/oura-models/onnx')
const CONSTANTS_DIR = path.join(ROOT, 'lib/oura-models/constants')
// Directory existence is the wrong question now the vendored JSONs are gone: `constants/` survives
// the deletion holding our own loader, its types and this suite's siblings, so it exists with
// nothing in it to compare against. `hasRealConstants()` asks for MANIFEST.json, which is what the
// delivery check asks for too.

describe('REQUIRED_MODEL_FILES', () => {
  it('matches every .onnx filename the inference modules actually load', () => {
    // The list is hand-maintained on purpose (a check that reads the directory can never notice an
    // absent file), so this is what stops it drifting: add a model without listing it and this fails.
    const dir = path.join(ROOT, 'lib/oura-models/inference')
    const referenced = new Set<string>()
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      for (const m of src.matchAll(/'([\w.]+\.onnx)'/g)) referenced.add(m[1])
    }
    expect([...referenced].sort()).toEqual([...REQUIRED_MODEL_FILES].sort())
  })

  // Tree presence is a contract only while the tree is where the models live. Q-49 moves them to
  // object storage, and this assertion is the one that would go red on the day that happens — for a
  // reason that is correct rather than a regression. So it holds itself to the tree only while the
  // tree has them, and production's guarantee moves to where it belongs: the boot check in
  // `instrumentation-node.ts` and `GET /api/admin/model-assets`, both of which ask the bucket.
  // Nothing here can ask the bucket — tests hold no storage credentials, by design.
  it.skipIf(!fs.existsSync(path.join(ONNX_DIR, REQUIRED_MODEL_FILES[0])))(
    'every required file is present and non-empty in the tree today',
    async () => {
      const report = await verifyModelAssets(ONNX_DIR)
      expect(describeModelAssetReport(report)).toBeNull()
      expect(report.ok).toBe(true)
    },
  )
})

describe('verifyModelAssets', () => {
  it('reports every file missing for a directory that does not exist, rather than throwing', async () => {
    const report = await verifyModelAssets(path.join(ROOT, 'no-such-dir-for-tests'))
    expect(report.ok).toBe(false)
    expect(report.missing).toEqual([...REQUIRED_MODEL_FILES])
    expect(describeModelAssetReport(report)).toContain('missing:')
  })

  it('treats a zero-length file as unusable, not present', async () => {
    // The signature of a truncated fetch: the file exists, so a presence-only check would pass while
    // every InferenceSession.create fails at request time.
    const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.model-assets-test-'))
    try {
      for (const f of REQUIRED_MODEL_FILES) fs.writeFileSync(path.join(tmp, f), f === REQUIRED_MODEL_FILES[0] ? '' : 'x')
      const report = await verifyModelAssets(tmp)
      expect(report.ok).toBe(false)
      expect(report.missing).toEqual([])
      expect(report.empty).toEqual([REQUIRED_MODEL_FILES[0]])
      expect(describeModelAssetReport(report)).toContain('zero-length:')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('constantsRequired', () => {
  // The point of pinning the constants filenames is that the upload stays verifiable AFTER the tree
  // copies are deleted — at that moment nothing else in the repo knows what the set should contain,
  // so `GET /api/admin/model-assets` would have nothing to compare the bucket against. The list is
  // only trustworthy if it was correct on the day the tree went away, which is what this asserts
  // while the tree is still here. It skips itself afterwards, like its ONNX sibling above, because
  // by then the tree's absence is the expected state rather than a regression.
  it.skipIf(!hasRealConstants())('matches the top-level .json files in the constants tree', () => {
    const tree = fs.readdirSync(CONSTANTS_DIR).filter(f => f.endsWith('.json')).sort()
    expect([...modelFiles.constantsRequired].sort()).toEqual(tree)
  })

  it('names MANIFEST.json, which is what the boot-time delivery check looks for', () => {
    // `constants-delivery.ts` treats a downloaded set without MANIFEST.json as unusable however many
    // other files arrived, so omitting it here would let the report pass a set the app rejects.
    expect(modelFiles.constantsRequired).toContain('MANIFEST.json')
  })
})
