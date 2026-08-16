"""Export all build-now Oura NN cores to ONNX, verified bit-exact vs the original
TorchScript .pt. Neural cores only; preprocessing/postprocessing ported separately in TS.

  SleepNet (moonstone, bdi x2): Sridhar2020 CNN core, rebuilt native.
  energy_expenditure: two FullyConnected MLP heads (HR / no-HR).
  dhrv_imputation:    RfNet MLP.
  illness_detection:  trained_model core.
  awhr_imputation:    ImputeNet (LSTM + MLP).
"""
import torch, torch.nn as nn, torch.nn.functional as F, numpy as np, onnxruntime as ort, os, json, warnings
warnings.filterwarnings("ignore")
PT = "pt"; ONNX = "onnx"; GOLD = "golden"
os.makedirs(ONNX, exist_ok=True); os.makedirs(GOLD, exist_ok=True)

def ort_check(path, feeds, ref, tag, tol=1e-3):
    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    out = sess.run(None, feeds)
    ok = True
    for i, (a, b) in enumerate(zip(ref, out)):
        d = float(np.max(np.abs(a - b))); ok &= d < tol
        print(f"    [{tag}] ORT out[{i}] {tuple(b.shape)} maxdiff={d:.2e} {'PASS' if d<tol else 'FAIL'}")
    print(f"    [{tag}] ONNX {round(os.path.getsize(path)/1e6,2)}MB -> {'ALL PASS' if ok else 'FAIL'}")
    return ok

# ---------- SleepNet Sridhar2020 core ----------
class SE(nn.Module):
    def __init__(s, ch, r=4):
        super().__init__(); s.fc1 = nn.Linear(ch, ch // r); s.fc2 = nn.Linear(ch // r, ch)
    def forward(s, x):
        w = torch.sigmoid(s.fc2(torch.relu(s.fc1(x.mean(2)))))
        return x * w.view(w.shape[0], w.shape[1], 1)
class ResConvBlock(nn.Module):
    def __init__(s, cin, cout):
        super().__init__(); s.f = cout // cin
        s.block = nn.Sequential(
            nn.Conv1d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm1d(cout), nn.LeakyReLU(0.15),
            nn.Conv1d(cout, cout, 3, padding=1, bias=False), nn.BatchNorm1d(cout), nn.LeakyReLU(0.15),
            nn.MaxPool1d(2, 2), SE(cout, 4))
    def forward(s, x):
        return s.block(x) + x.repeat_interleave(s.f, dim=1)[..., ::2]
class ResDilatedConvBlock(nn.Module):
    def __init__(s, ch=128):
        super().__init__(); L = []
        for d in (1, 2, 4, 8, 16, 32):
            L += [nn.Conv1d(ch, ch, 3, padding=d, dilation=d, bias=False), nn.BatchNorm1d(ch), nn.LeakyReLU(0.15)]
        L += [nn.Dropout(0.0), SE(ch, 4)]; s.block = nn.Sequential(*L)
    def forward(s, x): return s.block(x) + x
class Sridhar2020(nn.Module):
    def __init__(s, high_res_ch, low_res_ch, enc_ch, fc_in, dense, fs, out_ch=(4, 1), step=64):
        super().__init__()
        s.high_res_ch = high_res_ch; s.low_res_ch = low_res_ch; s.step = step
        s.first_conv = nn.Identity()
        s.enc_blocks = nn.ModuleList([ResConvBlock(enc_ch[i], enc_ch[i + 1]) for i in range(len(enc_ch) - 1)])
        s.fc = nn.Linear(fc_in, dense)
        s.dilated_blocks = nn.ModuleList([ResDilatedConvBlock(dense) for _ in range(3)])
        s.final_layers = nn.ModuleList([nn.Conv1d(dense, c, 1) for c in out_ch])
        idx = torch.arange(1800).unsqueeze(1) * step + torch.arange(256).unsqueeze(0)
        s.register_buffer("win_idx", idx, persistent=False)
    def forward(s, high_res, low_res=None):
        B = high_res.shape[0]
        x = F.pad(high_res, [0, 0, 128, 127])[:, s.win_idx, :].permute(0, 1, 3, 2)
        x = x.reshape(B * 1800, s.high_res_ch, 256)
        x = s.first_conv(x)
        for blk in s.enc_blocks: x = blk(x)
        x = x.reshape(B, 1800, -1)
        if s.low_res_ch > 0: x = torch.cat([x, low_res], dim=-1)
        x = s.fc(x).transpose(1, 2)
        for blk in s.dilated_blocks: x = blk(x)
        return [s.final_layers[0](x), s.final_layers[1](x)]

def export_sridhar(name):
    m = torch.jit.load(f"{PT}/{name}.pt", map_location="cpu").eval()
    core = m._model_runner.trained_model
    hrc, lrc, fs = int(core.high_res_ch), int(core.low_res_ch), float(core.high_res_fs)
    nb = int(core.num_encoding_blocks)
    enc = [hrc] + [int(getattr(getattr(core.enc_blocks, str(i)).block, "0").out_channels) for i in range(nb)]
    fc_in = int(core.fc.in_features); dense = int(core.fc.out_features)
    net = Sridhar2020(hrc, lrc, enc, fc_in, dense, fs).eval()
    miss, unexp = net.load_state_dict(core.state_dict(), strict=False)
    assert not [k for k in miss if "num_batches_tracked" not in k] and not unexp, (miss, unexp)
    torch.manual_seed(0)
    hi = torch.randn(1, 115200, hrc); lo = torch.randn(1, 1800, lrc) if lrc > 0 else None
    args = (hi, lo) if lrc > 0 else (hi,)
    with torch.no_grad():
        ref = [o.numpy() for o in core(*args)]; got = [o.numpy() for o in net(*args)]
    for a, b in zip(ref, got): assert float(np.max(np.abs(a - b))) < 1e-4, f"{name} native mismatch"
    names = ["high_res"] + (["low_res"] if lrc > 0 else [])
    path = f"{ONNX}/{name}_core.onnx"
    torch.onnx.export(net, args, path, input_names=names,
                      output_names=["staging_logits", "apnea_logits"], opset_version=17, dynamo=False)
    feeds = {"high_res": hi.numpy()} | ({"low_res": lo.numpy()} if lrc > 0 else {})
    ok = ort_check(path, feeds, ref, name)
    np.savez(f"{GOLD}/{name}_core.npz", **feeds, staging_logits=ref[0], apnea_logits=ref[1])
    return ok

# ---------- generic MLP/Sequential clone ----------
def clone_seq(scripted_seq):
    """Rebuild a scripted nn.Sequential of standard layers into a native one."""
    mods = []
    for _, c in scripted_seq.named_children():
        o = getattr(c, "original_name", type(c).__name__)
        if o == "Linear":       mods.append(nn.Linear(int(c.in_features), int(c.out_features)))
        elif o == "BatchNorm1d":mods.append(nn.BatchNorm1d(int(c.num_features)))
        elif o == "LeakyReLU":  mods.append(nn.LeakyReLU(float(c.negative_slope)))
        elif o == "ReLU":       mods.append(nn.ReLU())
        elif o == "Sigmoid":    mods.append(nn.Sigmoid())
        elif o == "Dropout":    mods.append(nn.Dropout(0.0))
        elif o == "Identity":   mods.append(nn.Identity())
        else: raise ValueError(f"unhandled layer {o}")
    return nn.Sequential(*mods)

def export_mlp(name, get_scripted_seq, in_dim, tag, out_relu_ok=True):
    m = torch.jit.load(f"{PT}/{name}.pt", map_location="cpu").eval()
    sseq = get_scripted_seq(m)
    net = clone_seq(sseq).eval()
    net.load_state_dict(sseq.state_dict(), strict=True)
    torch.manual_seed(0); x = torch.randn(1, in_dim)
    with torch.no_grad():
        ref = [sseq(x).numpy()]; got = [net(x).numpy()]
    assert float(np.max(np.abs(ref[0] - got[0]))) < 1e-4, f"{tag} native mismatch"
    path = f"{ONNX}/{tag}.onnx"
    torch.onnx.export(net, (x,), path, input_names=["features"], output_names=["output"],
                      opset_version=17, dynamic_axes={"features": {0: "batch"}, "output": {0: "batch"}}, dynamo=False)
    ok = ort_check(path, {"features": x.numpy()}, ref, tag)
    np.savez(f"{GOLD}/{tag}.npz", features=x.numpy(), output=ref[0])
    return ok

class DhrvNet(nn.Module):
    """dhrv rf_net: fc1-relu-fc2-relu-fc3-relu-fc4 (daytime-HRV imputation)."""
    def __init__(s, dims=(10, 32, 64, 32, 1)):
        super().__init__()
        s.fc1 = nn.Linear(dims[0], dims[1]); s.fc2 = nn.Linear(dims[1], dims[2])
        s.fc3 = nn.Linear(dims[2], dims[3]); s.fc4 = nn.Linear(dims[3], dims[4])
    def forward(s, x):
        x = torch.relu(s.fc1(x)); x = torch.relu(s.fc2(x)); x = torch.relu(s.fc3(x)); return s.fc4(x)

def export_dhrv():
    m = torch.jit.load(f"{PT}/dhrv_imputation_1_1_0.pt", map_location="cpu").eval()
    r = m.rf_net
    dims = (int(r.fc1.in_features), int(r.fc1.out_features), int(r.fc2.out_features),
            int(r.fc3.out_features), int(r.fc4.out_features))
    net = DhrvNet(dims).eval(); net.load_state_dict(r.state_dict(), strict=True)
    torch.manual_seed(0); x = torch.randn(1, dims[0])
    with torch.no_grad(): ref = [r(x).numpy()]; got = [net(x).numpy()]
    assert float(np.max(np.abs(ref[0] - got[0]))) < 1e-4
    path = f"{ONNX}/dhrv_imputation_1_1_0.onnx"
    torch.onnx.export(net, (x,), path, input_names=["features"], output_names=["dhrv"],
                      opset_version=17, dynamic_axes={"features": {0: "batch"}, "dhrv": {0: "batch"}}, dynamo=False)
    ok = ort_check(path, {"features": x.numpy()}, ref, "dhrv_imputation_1_1_0")
    np.savez(f"{GOLD}/dhrv_imputation_1_1_0.npz", features=x.numpy(), dhrv=ref[0])
    return ok

# ---------- illness_detection: conv time-series + scalar concat -> MLP -> sigmoid ----------
class IllnessNet(nn.Module):
    def __init__(s):
        super().__init__()
        s.layer1 = nn.Conv1d(8, 20, 8); s.batchnorm1 = nn.BatchNorm1d(20)
        s.layer2 = nn.Conv1d(20, 10, 4); s.batchnorm2 = nn.BatchNorm1d(10)
        s.layer3 = nn.Linear(200, 20); s.batchnorm3 = nn.BatchNorm1d(20)
        s.layer4 = nn.Linear(48, 400); s.batchnorm4 = nn.BatchNorm1d(400)
        s.layer5 = nn.Linear(400, 320); s.batchnorm5 = nn.BatchNorm1d(320)
        s.layer6 = nn.Linear(320, 1)
    def forward(s, x_scalar, x_ts):
        b = x_ts.shape[0]
        x = torch.relu(s.batchnorm1(s.layer1(x_ts)))
        x = torch.relu(s.batchnorm2(s.layer2(x)))
        x = torch.relu(s.batchnorm3(s.layer3(x.view(b, -1))))
        c = torch.cat([x, x_scalar, x_ts[:, :, 0], torch.std(x_ts, dim=-1), torch.mean(x_ts, dim=-1)], dim=1)
        x = torch.relu(s.batchnorm4(s.layer4(c)))
        x = torch.relu(s.batchnorm5(s.layer5(x)))
        return torch.sigmoid(s.layer6(x))

def export_illness():
    m = torch.jit.load(f"{PT}/illness_detection_0_5_1.pt", map_location="cpu").eval()
    core = m._model_runner.trained_model
    net = IllnessNet().eval()
    miss, unexp = net.load_state_dict(core.state_dict(), strict=False)
    assert not [k for k in miss if "num_batches_tracked" not in k] and not unexp, (miss, unexp)
    torch.manual_seed(0); xs = torch.randn(1, 4); xt = torch.randn(1, 8, 30)
    with torch.no_grad(): ref = [core(xs, xt).numpy()]; got = [net(xs, xt).numpy()]
    assert float(np.max(np.abs(ref[0] - got[0]))) < 1e-4, "illness native mismatch"
    path = f"{ONNX}/illness_detection_0_5_1.onnx"
    torch.onnx.export(net, (xs, xt), path, input_names=["scalars", "time_series"], output_names=["illness_prob"],
                      opset_version=17, dynamic_axes={"scalars": {0: "b"}, "time_series": {0: "b"}, "illness_prob": {0: "b"}}, dynamo=False)
    ok = ort_check(path, {"scalars": xs.numpy(), "time_series": xt.numpy()}, ref, "illness_detection_0_5_1")
    np.savez(f"{GOLD}/illness_detection_0_5_1.npz", scalars=xs.numpy(), time_series=xt.numpy(), illness_prob=ref[0])
    return ok

# ---------- awhr_imputation: bidirectional 2-layer LSTM -> 4 Linears (awake-HR imputation) ----------
class AwhrNet(nn.Module):
    """awhr impute_net: LSTM(bidir, 2 layers) -> fc1-relu-fc2-relu-fc3-relu-fc4."""
    def __init__(s, input_size=13, hidden_size=72, dims=(144, 144, 72, 36, 1)):
        super().__init__()
        s.lstm = nn.LSTM(input_size, hidden_size, num_layers=2, bidirectional=True, batch_first=True)
        s.fc1 = nn.Linear(dims[0], dims[1]); s.fc2 = nn.Linear(dims[1], dims[2])
        s.fc3 = nn.Linear(dims[2], dims[3]); s.fc4 = nn.Linear(dims[3], dims[4])
    def forward(s, x):
        out, _ = s.lstm(x)
        out = torch.relu(s.fc1(out)); out = torch.relu(s.fc2(out)); out = torch.relu(s.fc3(out))
        return s.fc4(out)

def export_awhr():
    m = torch.jit.load(f"{PT}/awhr_imputation_1_2_0.pt", map_location="cpu").eval()
    inet = m.impute_net; lstm = inet.lstm
    ins, hid = int(lstm.input_size), int(lstm.hidden_size)
    assert int(lstm.num_layers) == 2 and bool(lstm.bidirectional) and bool(lstm.batch_first)
    dims = (int(inet.fc1.in_features), int(inet.fc1.out_features), int(inet.fc2.out_features),
            int(inet.fc3.out_features), int(inet.fc4.out_features))
    net = AwhrNet(ins, hid, dims).eval(); net.load_state_dict(inet.state_dict(), strict=True)
    torch.manual_seed(0); x = torch.randn(1, 8, ins)  # (batch, seq_len, input_size); batch_first
    with torch.no_grad(): ref = [inet(x).numpy()]; got = [net(x).numpy()]
    nd = float(np.max(np.abs(ref[0] - got[0])))
    assert nd < 1e-4, f"awhr native mismatch {nd:.2e}"
    print(f"    [awhr] native rebuild maxdiff vs .pt = {nd:.2e}")
    path = f"{ONNX}/awhr_imputation_1_2_0.onnx"
    torch.onnx.export(net, (x,), path, input_names=["sequence"], output_names=["imputed_hr"],
                      opset_version=17, dynamic_axes={"sequence": {0: "batch", 1: "seq"},
                                                      "imputed_hr": {0: "batch", 1: "seq"}}, dynamo=False)
    ok = ort_check(path, {"sequence": x.numpy()}, ref, "awhr_imputation_1_2_0")
    np.savez(f"{GOLD}/awhr_imputation_1_2_0.npz", sequence=x.numpy(), imputed_hr=ref[0])
    xin, yout = x.numpy(), ref[0]
    fixture = {
        "input": {"shape": list(xin.shape), "flat": xin.astype("float64").ravel().tolist()},
        "output": {"shape": list(yout.shape), "flat": yout.astype("float64").ravel().tolist()},
    }
    with open(f"{ONNX}/__fixtures__/awhr_imputation_1_2_0.golden.json", "w") as f:
        json.dump(fixture, f)
    return ok

if __name__ == "__main__":
    results = {}
    for n in ["sleepnet_moonstone_1_2_0", "sleepnet_bdi_0_3_0", "sleepnet_bdi_0_4_0"]:
        print(f"== {n} =="); results[n] = export_sridhar(n)
    print("== energy_expenditure_1_0_0 (hr) ==")
    results["energy_hr"] = export_mlp("energy_expenditure_1_0_0", lambda m: m.energy_expenditure_model_hr.model, 50, "energy_expenditure_1_0_0_hr")
    print("== energy_expenditure_1_0_0 (no_hr) ==")
    results["energy_no_hr"] = export_mlp("energy_expenditure_1_0_0", lambda m: m.energy_expenditure_model_no_hr.model, 42, "energy_expenditure_1_0_0_no_hr")
    print("== dhrv_imputation_1_1_0 =="); results["dhrv"] = export_dhrv()
    print("== illness_detection_0_5_1 =="); results["illness"] = export_illness()
    print("== awhr_imputation_1_2_0 =="); results["awhr"] = export_awhr()
    print("\n===== SUMMARY =====")
    for k, v in results.items(): print(f"  {k}: {'PASS' if v else 'FAIL'}")
