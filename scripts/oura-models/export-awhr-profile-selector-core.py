#!/usr/bin/env python3
"""Export the awhr_profile_selector_1_0_1 NEURAL CORE to ONNX, bit-exact vs the .pt, and verify the
full TS-glue pipeline (replicated here in numpy) reproduces the golden.

The core is: activity_core_model.model (Sequential: BatchNorm1d/Linear/LeakyReLU/Dropout) -> reshape
[1,T,-1] -> LSTM -> fc (Linear), returning per-timestep logits [T, num_classes]. The glue ported
separately in lib/oura-models/inference/awhr-profile-selector.ts is: column select, nearest-timestamp
merge, nan->0, the zero-row NaN mask, softmax, mean-aggregation + argmax, id->ecore mapping, and
resample-by-flooring. The zero-row NaN mask is applied to the LSTM *output* (after the LSTM runs on
finite inputs), so exporting the finite core and masking softmax rows in TS is exact.

TorchScript->ONNX can't export the full app graph (nan ops, dict lookups, dynamic resample), which is
why only the clean NN core is exported — same approach as export-step-counter-core.py.

Owner-run (needs the .pt from the docs/preserve-pt-originals-and-goldens backup branch + torch +
onnxruntime). Writes lib/oura-models/onnx/awhr_profile_selector_1_0_1_core.onnx.
"""
import os
import warnings

import numpy as np
import torch

warnings.filterwarnings("ignore")
torch.set_grad_enabled(False)

PT = "lib/oura-models/pt/awhr_profile_selector_1_0_1.pt"
OUT = "lib/oura-models/onnx/awhr_profile_selector_1_0_1_core.onnx"
GOLD = "lib/oura-models/goldens/awhr_profile_selector_1_0_1.golden.npz"

m = torch.jit.load(PT, map_location="cpu").eval()
d = np.load(GOLD)

smc = list(m.selected_stepmotion_columns)
mc = list(m.selected_motion_columns)
shift_sm = float(m.shift_stepmotion)
shift_m = float(m.shift_motion)
max_delta = float(m.max_delta_ms)
id_to_ecore = {int(k): int(v) for k, v in dict(m.activity_model_id_to_ecore_id).items()}
num_classes = int(m.model.num_classes)


# ── Replicate _merge_on_timestamp (glue) ──────────────────────────────────────────────
def merge_on_timestamp(sm_ts, sm_data, mo_ts, mo_data):
    n, nsf, nmf = sm_ts.shape[0], sm_data.shape[1], mo_data.shape[1]
    merged = np.full((n, nsf + nmf), np.nan, dtype=np.float64)
    merged[:, :nsf] = sm_data
    cur = 0
    for i in range(n):
        delta = np.abs((sm_ts[i] + shift_sm) - (mo_ts[cur:] + shift_m))
        if delta.size > 0 and float(delta.min()) <= max_delta:
            fi = int(delta.argmin()) + cur
            merged[i, nsf:] = mo_data[fi]
            cur = fi
    return merged


sm_ts = d["in_0"].astype(np.int64)
sm_data = d["in_1"][:, smc].astype(np.float64)
mo_ts = d["in_2"].astype(np.int64)
mo_data = d["in_3"][:, mc].astype(np.float64)
merged = merge_on_timestamp(sm_ts, sm_data, mo_ts, mo_data)


# ── The exportable neural core, rebuilt as a plain nn.Module (ScriptModule submodules
#    can't be re-traced), with weights copied from the .pt. Architecture from the constants:
#    Sequential = [BN(19), Linear(19,32), BN, LReLU, Drop] + 6×[Linear(32,32), BN, LReLU, Drop]
#    + [Linear(32,6), BN(6), LReLU, Drop] → LSTM(6→16, bidir) → fc(32→3). ────────────────
import torch.nn as nn  # noqa: E402


def build_seq():
    L = 0.01  # LeakyReLU negative_slope (all layers)
    layers = [nn.BatchNorm1d(19), nn.Linear(19, 32), nn.BatchNorm1d(32), nn.LeakyReLU(L), nn.Dropout(0.1)]
    for _ in range(6):
        layers += [nn.Linear(32, 32), nn.BatchNorm1d(32), nn.LeakyReLU(L), nn.Dropout(0.1)]
    layers += [nn.Linear(32, 6), nn.BatchNorm1d(6), nn.LeakyReLU(L), nn.Dropout(0.01)]
    return nn.Sequential(*layers)


class Core(nn.Module):
    def __init__(self):
        super().__init__()
        self.seq = build_seq()
        self.lstm = nn.LSTM(6, 16, num_layers=1, batch_first=True, bidirectional=True)
        self.fc = nn.Linear(32, 3)

    def forward(self, x0):  # x0: [T, n_features] (already nan->0)
        core_f = self.seq(x0)                          # [T, 6]
        core_f = core_f.reshape(1, core_f.shape[0], -1)  # [1, T, 6]
        rnn_out, _ = self.lstm(core_f)                 # [1, T, 32]
        out = self.fc(rnn_out)                         # [1, T, 3]
        return out.squeeze(0)                          # [T, 3] logits


core = Core().eval()
src = m.state_dict()
mapped = {}
for k, v in src.items():
    if k.startswith("model.activity_core_model.model."):
        mapped["seq." + k[len("model.activity_core_model.model."):]] = v
    elif k.startswith("model.rnn."):
        mapped["lstm." + k[len("model.rnn."):]] = v
    elif k.startswith("model.fc."):
        mapped["fc." + k[len("model.fc."):]] = v
missing, unexpected = core.load_state_dict(mapped, strict=False)
assert not [k for k in missing if "num_batches_tracked" not in k], f"missing weights: {missing}"

x0 = torch.tensor(np.nan_to_num(merged, nan=0.0), dtype=torch.float32)

# Verify the rebuilt core matches the scripted .pt end-to-end: softmax(core logits) must equal the
# scripted model's per-timestep probabilities on non-zero rows.
ref = m.model.forward(torch.tensor(merged, dtype=torch.float32).unsqueeze(0), True).squeeze(0).numpy()
mine = torch.softmax(core(x0), dim=1).numpy()
nz = ~np.all(merged == 0.0, axis=1)
rebuild_diff = float(np.max(np.abs(ref[nz].astype("float64") - mine[nz].astype("float64"))))
print(f"rebuilt core vs scripted .pt (softmax, non-zero rows) maxdiff = {rebuild_diff:.2e}")
assert rebuild_diff < 1e-4, "rebuilt core diverged from the scripted .pt"

os.makedirs(os.path.dirname(OUT), exist_ok=True)
torch.onnx.export(core, (x0,), OUT, input_names=["merged_features"], output_names=["logits"],
                  opset_version=17, dynamo=False,
                  dynamic_axes={"merged_features": {0: "t"}, "logits": {0: "t"}})

import onnxruntime as ort  # noqa: E402

sess = ort.InferenceSession(OUT, providers=["CPUExecutionProvider"])
onnx_logits = sess.run(None, {"merged_features": x0.numpy()})[0]
core_diff = float(np.max(np.abs(core(x0).numpy().astype("float64") - onnx_logits.astype("float64"))))
print(f"exported {OUT} ({round(os.path.getsize(OUT) / 1e3, 1)} KB); core logits maxdiff vs .pt = {core_diff:.2e}")
assert core_diff < 1e-4, "core ONNX diverged from .pt"


# ── Full glue pipeline in numpy (this is the TS spec) → reproduce the golden ───────────
def softmax_rows(logits):
    mx = logits.max(axis=1, keepdims=True)
    e = np.exp(logits - mx)
    return e / e.sum(axis=1, keepdims=True)

zero_mask = np.all(merged == 0.0, axis=1)  # NOTE: on merged (pre-nan->0) — a row of exact zeros
probs = softmax_rows(onnx_logits.astype(np.float64))
probs[zero_mask] = np.nan                  # zero rows -> NaN probabilities

agg = probs.mean(axis=0)                    # torch.mean over timesteps (NaN-propagating)
main_id = int(np.argmax(agg))
main_ecore = float(id_to_ecore[main_id])

interval = int(d["in_4"][0])
resampled_ts = interval * (sm_ts // interval)
uniq = np.unique(resampled_ts)             # sorted unique
block_probs = np.zeros((uniq.shape[0], num_classes))
for i, b in enumerate(uniq):
    block_probs[i] = probs[resampled_ts == b].mean(axis=0)
ecore_ids = np.array([[float(id_to_ecore[int(np.argmax(block_probs[i]))])] for i in range(uniq.shape[0])])

# Compare to golden.
e0 = abs(main_ecore - float(d["out_0"]))
e1 = int(np.max(np.abs(uniq - d["out_1"].reshape(-1))))
e2 = float(np.max(np.abs(ecore_ids - d["out_2"])))
print(f"pipeline vs golden: out_0 err={e0} out_1 err={e1} out_2 err={e2}")
print(f"  main_activity_ecore_id={main_ecore} n_blocks={uniq.shape[0]} ecore_ids={ecore_ids.reshape(-1).tolist()}")
assert e0 == 0 and e1 == 0 and e2 == 0.0, "glue pipeline diverged from golden"
print("OK — ONNX core + numpy glue reproduce the golden exactly")
print(f"constants: shift_sm={shift_sm} shift_m={shift_m} max_delta={max_delta} num_classes={num_classes} id_to_ecore={id_to_ecore}")
print(f"selected_stepmotion_columns={smc} selected_motion_columns={mc}")
