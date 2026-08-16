#!/usr/bin/env python3
"""Oracle + synthetic-vector generator for the astd_event_detection_0_1_0 TS port.

The captured golden is the zero-events case (its 1 ms bin spacing makes every 4-bin window shorter
than min_window_delta_ms), so it does not exercise event collection / sort / merge / durations. This
script (1) confirms the .pt reproduces the golden, and (2) regenerates the synthetic event vectors
(15-min-spaced bins with stressed / restored / borderline / NaN runs) captured from the same .pt into
lib/oura-models/onnx/__fixtures__/astd_event_detection_0_1_0.scenarios.json — the fixture the TS
parity test pins the event path against. The .pt is gitignored — fetch it from the
docs/preserve-pt-originals-and-goldens backup branch first.
"""
import json
import numpy as np
import torch

torch.set_grad_enabled(False)

PT = "lib/oura-models/pt/astd_event_detection_0_1_0.pt"
GOLDEN = "lib/oura-models/goldens/astd_event_detection_0_1_0.golden.npz"
SCENARIOS = "lib/oura-models/onnx/__fixtures__/astd_event_detection_0_1_0.scenarios.json"
BIN_MS = 900000  # 15 minutes

m = torch.jit.load(PT, map_location="cpu").eval()

# 1) Reproduce the golden.
d = np.load(GOLDEN)
out = m(torch.from_numpy(d["in_0"].copy()), torch.from_numpy(d["in_1"].copy()))
maxerr = 0.0
for i, o in enumerate(out):
    got = np.asarray(o).reshape(-1)
    exp = d[f"out_{i}"].reshape(-1)
    if got.size == exp.size and got.size > 0:
        maxerr = max(maxerr, float(np.abs(got - exp).max()))
    assert got.size == exp.size, f"out_{i} shape mismatch"
print(f"golden reproduced, max abs err = {maxerr}")


def run(vals):
    n = len(vals)
    ts = (np.arange(n, dtype=np.int64) * BIN_MS)
    o = m(torch.tensor(vals, dtype=torch.float32), torch.from_numpy(ts))
    return ts, [np.asarray(x).reshape(-1).tolist() for x in o]


# 2) Regenerate the synthetic event vectors (deterministic).
scenarios = {}
valsA = [-0.6] * 6 + [0.0] * 4 + [0.6] * 6            # stressed then restored event
valsB = [-0.6, -0.45, -0.6, -0.55, float("nan"), -0.6, -0.7, -0.6]  # borderline + 1 NaN
valsC = [-0.6] * 4 + [0.0] * 1 + [-0.6] * 4           # two windows merged across a gap
for name, vals in [("stressed_and_restored", valsA), ("stressed_borderline_nan", valsB), ("stressed_merge", valsC)]:
    ts, outs = run(vals)
    scenarios[name] = {
        "values": [None if (x != x) else x for x in vals],
        "timestamps": ts.tolist(),
        "outputs": outs,
    }
    print(f"{name}: n_stressed={outs[0]} n_restored={outs[1]} type_ids={outs[4]} durations={outs[7]}")

json.dump(scenarios, open(SCENARIOS, "w"))
print(f"wrote {SCENARIOS}")
