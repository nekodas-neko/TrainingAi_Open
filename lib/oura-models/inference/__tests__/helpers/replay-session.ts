/**
 * Replay recorded model outputs so the inference tests keep running once the `.onnx` files leave
 * the repo (Q-49 Phase A2).
 *
 * ## Why not just skip the tests
 *
 * These tests are not about the models. A `.onnx` file is a frozen binary — it cannot regress. What
 * can regress is **our** code around it: the input-shape guards, how the feed tensors are laid out,
 * the argmax over the staging logits, the sigmoid threshold, the null-on-failure contract. Skipping
 * the tests when the model is absent would drop exactly the coverage worth having.
 *
 * So the model is replaced by a recording of itself, and everything else runs for real. The test
 * builds real `ort.Tensor` feeds, and a stub session returns the outputs the real model produced for
 * those exact feeds. Every line of our TypeScript executes as it does in production.
 *
 * ## Fixtures are keyed by the input, not by a name
 *
 * A recording is stored under a hash of the feeds it was produced from. That has two consequences
 * worth relying on: a test file can run a model any number of times and each call finds its own
 * recording with no manual bookkeeping, and **changing a test's input fails loudly** with "no
 * recording for this input" rather than silently comparing against a stale one. A name would have
 * allowed that silent drift; a hash cannot.
 *
 * ## Re-recording
 *
 * Recordings are produced from the real models, so re-recording needs a tree (or bucket) that has
 * them:
 *
 *     RECORD_MODEL_FIXTURES=1 npx vitest run lib/oura-models/inference/__tests__
 *
 * In that mode `getSession` is the real one and every `run()` is written to disk as it happens.
 * Commit the result. Without the env var — which is every CI run and every ordinary `pnpm test` —
 * nothing touches a `.onnx` file at all.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const RECORDING = process.env.RECORD_MODEL_FIXTURES === '1'

const REPLAY_DIR = path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__', 'replay')

/** A tensor as our inference code consumes it: `.data` is what every caller reads. */
interface TensorLike {
  data: ArrayLike<number> | ArrayLike<bigint>
  dims: readonly number[]
  type?: string
}

type Feeds = Record<string, TensorLike>
type Outputs = Record<string, TensorLike>

/**
 * Stable fingerprint of a set of feeds.
 *
 * Sorted keys so object-literal order cannot change the hash, and the raw element bytes rather than
 * a formatted number, so a float round-trips exactly. Dims are included because the same buffer
 * reshaped is a different input.
 */
function hashFeeds(feeds: Feeds): string {
  const h = crypto.createHash('sha256')
  for (const key of Object.keys(feeds).sort()) {
    const t = feeds[key]
    h.update(key)
    h.update(JSON.stringify(t.dims ?? []))
    const data = t.data as unknown as ArrayBufferView & { length: number }
    if (ArrayBuffer.isView(data)) {
      h.update(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    } else {
      h.update(JSON.stringify(Array.from(data as ArrayLike<number>)))
    }
  }
  return h.digest('hex').slice(0, 16)
}

const TYPED_ARRAYS: Record<string, new (buf: ArrayBuffer) => ArrayLike<unknown>> = {
  Float32Array,
  Float64Array,
  Int32Array,
  BigInt64Array,
  Int8Array,
  Uint8Array,
}

function serialize(outputs: Outputs) {
  const out: Record<string, { ctor: string; dims: readonly number[]; b64: string }> = {}
  for (const [name, t] of Object.entries(outputs)) {
    const data = t.data as unknown as ArrayBufferView
    if (!ArrayBuffer.isView(data)) throw new Error(`output "${name}" is not a typed array`)
    out[name] = {
      ctor: data.constructor.name,
      dims: t.dims ?? [],
      b64: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
    }
  }
  return out
}

function deserialize(raw: ReturnType<typeof serialize>): Outputs {
  const out: Outputs = {}
  for (const [name, rec] of Object.entries(raw)) {
    const Ctor = TYPED_ARRAYS[rec.ctor]
    if (!Ctor) throw new Error(`unsupported recorded tensor type "${rec.ctor}" for output "${name}"`)
    const buf = Buffer.from(rec.b64, 'base64')
    // Copy out of the Buffer pool — a pooled Buffer's ArrayBuffer is shared and much larger.
    const copy = new ArrayBuffer(buf.byteLength)
    Buffer.from(copy).set(buf)
    out[name] = { data: new Ctor(copy) as ArrayLike<number>, dims: rec.dims }
  }
  return out
}

function fixturePath(modelFile: string, hash: string) {
  return path.join(REPLAY_DIR, modelFile.replace(/\.onnx$/, ''), `${hash}.json`)
}

type SessionLike = { run: (feeds: Feeds) => Promise<Outputs> }

/**
 * Build the `getSession` replacement a test installs via `vi.mock('../session', …)`.
 *
 * The real loader is passed in rather than imported, because the module holding it is the one being
 * mocked — importing it here would resolve to the mock and recurse. The mock factory has the actual
 * module in hand (`importOriginal`), so it is the natural place to get it from.
 *
 * Replay mode never calls `realGetSession` at all, so no `.onnx` file is touched. Recording mode
 * delegates to it and writes each `run()` result to disk as it happens.
 */
export function makeReplayGetSession(
  realGetSession: (f: string) => Promise<unknown>,
): (modelFile: string) => Promise<SessionLike | null> {
  return function replayGetSession(modelFile: string) {
    if (RECORDING) {
      return realGetSession(modelFile).then(session => {
        if (!session) return null
        const run = (session as SessionLike).run.bind(session as SessionLike)
        return {
          async run(feeds: Feeds) {
            const outputs = await run(feeds)
            const file = fixturePath(modelFile, hashFeeds(feeds))
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, `${JSON.stringify(serialize(outputs))}\n`)
            return outputs
          },
        }
      })
    }

    return Promise.resolve<SessionLike>({
      async run(feeds: Feeds) {
        const hash = hashFeeds(feeds)
        const file = fixturePath(modelFile, hash)
        if (!fs.existsSync(file)) {
          throw new Error(
            `No recorded output for ${modelFile} with input ${hash}.\n` +
              `The test's input changed, or this call is new. Re-record against the real models:\n` +
              `  RECORD_MODEL_FIXTURES=1 npx vitest run lib/oura-models/inference/__tests__\n` +
              `Expected: ${path.relative(process.cwd(), file)}`,
          )
        }
        return deserialize(JSON.parse(fs.readFileSync(file, 'utf8')))
      },
    })
  }
}
