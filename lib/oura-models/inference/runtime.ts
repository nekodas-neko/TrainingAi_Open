/**
 * What a vendored ONNX model port needs from an inference runtime, and nothing else.
 *
 * There are two runtimes: `onnxruntime-node` (a native addon, server-only) and `onnxruntime-web`
 * (WASM, the WebView). A port that imports either one directly can only ever run on that side —
 * which is why `sleepnet.ts`, `step-counter.ts` and `dhrv.ts` were server-only for reasons that had
 * nothing to do with their maths. They take a `ModelRuntime` now, the same way the Oura rollup takes
 * a `RollupIO`, so the choice of runtime is made once at the composition root.
 *
 * Deliberately structural rather than importing either package's types: the two `InferenceSession`
 * types are not assignable to each other, and a port needs neither of their full surfaces.
 */

/** The subset of an ONNX output tensor a port reads. */
export interface ModelTensor {
  data: ArrayLike<number> | BigInt64Array
  dims?: readonly number[]
}

/**
 * A loaded model, plus the tensor factory belonging to the runtime that loaded it. They travel
 * together because a feed tensor must come from the same runtime as the session that consumes it —
 * separating them is how you get an `onnxruntime-web` tensor fed to a node session.
 */
export interface ModelSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, ModelTensor>>
  /** Build a float32 input tensor. Opaque to the caller; only this session's `run` consumes it. */
  float32(data: Float32Array, dims: number[]): unknown
}

export interface ModelRuntime {
  /**
   * A session for a vendored ONNX file. Returns `null` when the runtime or the model file is
   * unavailable — **infallible by contract**: callers fall back to their heuristic path, and this
   * must never throw.
   */
  session(fileName: string): Promise<ModelSession | null>
}
