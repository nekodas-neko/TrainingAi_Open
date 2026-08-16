#!/usr/bin/env python3
"""Convert a golden .npz (in_*/out_* keys) to a JSON fixture for TS parity tests.
Usage: python3 golden-to-json.py <model_name>  (reads lib/oura-models/goldens/<model>.golden.npz,
writes lib/oura-models/onnx/__fixtures__/<model>.golden.json). Each key -> {shape, flat} (row-major).
"""
import sys, json, numpy as np, os

model = sys.argv[1]
src = f"lib/oura-models/goldens/{model}.golden.npz"
dst = f"lib/oura-models/onnx/__fixtures__/{model}.golden.json"
d = np.load(src)
out = {}
for k in d.files:
    a = np.asarray(d[k])
    is_float = np.issubdtype(a.dtype, np.floating)
    out[k] = {"shape": list(a.shape),
              "flat": [None if (is_float and np.isnan(v)) else float(v) for v in a.reshape(-1)]}
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, "w") as f:
    json.dump(out, f, allow_nan=False)  # NaN → null above; guard against any slipping through as invalid JSON
print(f"wrote {dst}: keys={list(out.keys())}")
for k in d.files:
    print(f"  {k}: shape={list(np.asarray(d[k]).shape)}")
