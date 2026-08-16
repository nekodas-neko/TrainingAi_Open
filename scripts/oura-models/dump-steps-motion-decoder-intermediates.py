#!/usr/bin/env python3
"""Golden-reproduction oracle for the steps_motion_decoder_2_0_0 TS port.

Runs the scripted .pt on the golden inputs and confirms both outputs (interpolated
timestamps + dequantized [3N,11] gait features) reproduce the golden vector. The model is a
pure deterministic dequantizer, so this end-to-end check is the whole verification the TS port
needs (no submethod stage dumps required). The .pt is gitignored — fetch it from the
docs/preserve-pt-originals-and-goldens backup branch first.
"""
import numpy as np
import torch

torch.set_grad_enabled(False)

d = np.load("lib/oura-models/goldens/steps_motion_decoder_2_0_0.golden.npz")
m = torch.jit.load("lib/oura-models/pt/steps_motion_decoder_2_0_0.pt", map_location="cpu").eval()

ts = torch.from_numpy(d["in_0"].copy())
data = torch.from_numpy(d["in_1"].copy())
out_ts, out_data = m(ts, data)

err_ts = np.abs(np.asarray(out_ts).reshape(-1) - d["out_0"].reshape(-1)).max()
err_data = np.abs(np.asarray(out_data) - d["out_1"]).max()
print(f"out_0 (timestamps) max abs err = {err_ts}")
print(f"out_1 (gait features) max abs err = {err_data}")
print(f"shapes: timestamps {tuple(out_ts.shape)}, data {tuple(out_data.shape)}")
assert err_ts == 0 and err_data == 0.0, "golden reproduction FAILED"
print("OK — .pt reproduces the golden exactly")
