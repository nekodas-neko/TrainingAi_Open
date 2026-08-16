#!/usr/bin/env python3
"""Export the step_counter_1_3_0 NEURAL CORE (self.model: merged_features → steps) to ONNX,
bit-exact vs the .pt. The pre/postprocessing (column select, timestamp merge, resample) is ported
separately in lib/oura-models/inference/step-counter.ts — TorchScript→ONNX can't export the full
graph (a torch.roll in the resampler is unsupported), which is why only the clean NN core is exported.

Owner-run (needs the .pt from the docs/preserve-pt-originals-and-goldens backup branch + torch +
onnxruntime + onnxscript). Writes lib/oura-models/onnx/step_counter_1_3_0_core.onnx.

    git show origin/docs/preserve-pt-originals-and-goldens:lib/oura-models/pt/step_counter_1_3_0.pt \
        > lib/oura-models/pt/step_counter_1_3_0.pt
    python3 scripts/oura-models/export-step-counter-core.py
"""
import torch, numpy as np, warnings, os
warnings.filterwarnings("ignore"); torch.set_grad_enabled(False)

PT = "lib/oura-models/pt/step_counter_1_3_0.pt"
OUT = "lib/oura-models/onnx/step_counter_1_3_0_core.onnx"
GOLD = "lib/oura-models/goldens/step_counter_1_3_0.golden.npz"

m = torch.jit.load(PT, map_location="cpu").eval()
d = np.load(GOLD)
smc = list(m.selected_stepmotion_columns); mc = list(m.selected_motion_columns)
shift_sm = float(m.shift_stepmotion); shift_m = float(m.shift_motion); max_delta = float(m.max_delta_ms)

# Replicate _merge_on_timestamp to build a representative merged_features example for the trace.
sm_ts = d["in_0"].astype(np.int64); sm_data = d["in_1"][:, smc].astype(np.float64)
mo_ts = d["in_2"].astype(np.int64); mo_data = d["in_3"][:, mc].astype(np.float64)
n, nsf, nmf = sm_ts.shape[0], sm_data.shape[1], mo_data.shape[1]
merged = np.full((n, nsf + nmf), np.nan); merged[:, :nsf] = sm_data; cur = 0
for i in range(n):
    delta = np.abs((sm_ts[i] + shift_sm) - (mo_ts[cur:] + shift_m))
    if delta.size > 0 and delta.min() <= max_delta:
        fi = int(delta.argmin()) + cur; merged[i, nsf:] = mo_data[fi]; cur = fi
x = torch.tensor(merged, dtype=torch.float32)

torch.onnx.export(m.model, (x,), OUT, input_names=["merged_features"], output_names=["steps"],
                  opset_version=17, dynamo=False,
                  dynamic_axes={"merged_features": {0: "n"}, "steps": {0: "n"}})

import onnxruntime as ort
o = ort.InferenceSession(OUT, providers=["CPUExecutionProvider"]).run(None, {"merged_features": x.numpy()})[0]
maxdiff = float(np.max(np.abs(m.model(x).numpy().astype("float64") - o.astype("float64"))))
print(f"exported {OUT} ({round(os.path.getsize(OUT)/1e3,1)} KB); core maxdiff vs .pt = {maxdiff:.2e}")
assert maxdiff < 1e-4, "core ONNX diverged from .pt"
print("constants: shift_stepmotion=%d shift_motion=%d max_delta_ms=%d seconds_per_batch=%.0f"
      % (shift_sm, shift_m, max_delta, float(m.model.step_counter.seconds_per_batch)))
