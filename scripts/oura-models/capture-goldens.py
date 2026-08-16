"""Capture golden (input -> output) vectors from the original decrypted `.pt` TorchScript
models, so a future TypeScript port can be parity-verified WITHOUT needing the `.pt` in-sandbox.

Run:  cd lib/oura-models && python3 ../../scripts/oura-models/capture-goldens.py

Loads each `.pt` from `lib/oura-models/pt/`, runs a forward on a deterministic synthetic input
(torch.manual_seed(0)), and writes `<model>.golden.npz` (inputs + outputs) into
`lib/oura-models/goldens/`. Models whose strict input validators reject the generic synthetic
input are logged as SKIP — their `.pt` is committed, so their golden is regenerated during the
port build with a real input. Best-effort, deterministic, idempotent.
"""
import os, sys, json, warnings, traceback
import numpy as np
import torch
warnings.filterwarnings("ignore")
torch.manual_seed(0)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PT = os.path.join(ROOT, "lib", "oura-models", "pt")
SPECS = os.path.join(ROOT, "lib", "oura-models", "constants", "specs")
OUT = os.path.join(ROOT, "lib", "oura-models", "goldens")
os.makedirs(OUT, exist_ok=True)

# Already have committed goldens from the build sessions — skip (don't clobber the pinned ones).
ALREADY = {
    "sleepnet_moonstone_1_2_0",
    "energy_expenditure_1_0_0", "dhrv_imputation_1_1_0", "illness_detection_0_5_1",
}

# Per-model input builders. Each returns a tuple of positional args (torch tensors) matching the
# model's forward signature. Kept deliberately simple + deterministic; the point is a reproducible
# (input,output) pair pinned to the original .pt, not a semantically perfect scenario.
def T(*a, dtype=torch.float32):
    return torch.tensor(a, dtype=dtype)

def arange_f(n, lo=0.0, hi=1.0):
    return torch.linspace(lo, hi, n, dtype=torch.float32)

N = 128  # generic series length

def build_arg(name, typ):
    """Construct one forward arg from its declared name + TorchScript type, heuristically."""
    tstr = str(typ).lower()
    nm = name.lower()
    if tstr == "bool":
        return False
    if tstr in ("int", "float"):
        return 0 if tstr == "int" else 50.0
    is_int = "int" in tstr and "tensor" not in tstr[:6]
    # scalar-ish names → 1-element tensor
    scalar_kw = ("age", "sex", "baseline", "rhr", "readiness", "vo2", "score", "lim", "limit",
                 "no_ots", "tz_change", "index", "hours", "duration", "threshold", "avg", "average")
    ts_kw = ("timestamp", "timezones", "unix", "start", "end", "_ts", "times")
    if any(k in nm for k in ts_kw):
        # monotonically increasing int64 series (timestamps)
        return torch.arange(0, N, dtype=torch.int64) * 60 + 1_700_000_000
    if any(k in nm for k in scalar_kw):
        v = 1.0 if "sex" in nm else (0.0 if ("no_ots" in nm or "tz_change" in nm) else 50.0)
        return torch.tensor(v, dtype=torch.int64 if is_int else torch.float32)
    # default: a 1-D float series in a benign physiological range
    return torch.linspace(30.0, 60.0, N, dtype=torch.float32)

def build_from_schema(m):
    """Auto-build a positional arg tuple from the model's declared forward schema."""
    try:
        args = m.forward.schema.arguments[1:]  # drop `self`
    except Exception:
        return None
    if not args:
        return None
    return tuple(build_arg(a.name, a.type) for a in args)

def build(model, m):
    # Explicit builders for models whose validators need specific shapes/lengths the
    # name-heuristic can't infer (min-length series, matrix inputs). Pinned + deterministic.
    if model == "training_stress_score_0_2_1":
        # mets must be a long 1-min series (validator needs >= ~720 samples)
        return (T(1_700_000_000, dtype=torch.int64), torch.full((1440,), 1.2), T(30.0), T(1.0),
                T(55.0), T(0.0), T(0.0), T(75.0), T(45.0))
    if model == "astd_event_detection_0_1_0":
        return (torch.linspace(0.0, 1.0, 256, dtype=torch.float32), torch.arange(0, 256, dtype=torch.int64))
    if model == "steps_motion_decoder_2_0_0":
        return (torch.arange(0, 256, dtype=torch.int64), torch.randint(0, 255, (256, 27)).float())
    if model == "stress_daytime_sensing_1_1_0":
        # scalars as 1-D single-element tensors; daytime sample well outside the bedtime window
        return (T(45.0), T(1_700_050_800, dtype=torch.int64), T(1_699_997_600, dtype=torch.int64),
                T(1_700_026_400, dtype=torch.int64), T(45.0), T(50.0), T(1.2))
    if model == "daily_short_term_baselines_1_1_0":
        # validator caps observations at <=21
        s = lambda lo, hi: torch.linspace(lo, hi, 14, dtype=torch.float32)
        return (s(40, 55), s(33, 34), s(48, 60), s(6, 8) * 3600, s(48, 58), s(34, 35), s(40, 55))
    if model == "step_counter_1_3_0":
        # stepmotion/motion as (T, wide-feature) matrices; interval scalar
        ts = torch.arange(256, dtype=torch.int64) + 1_700_000_000
        return (ts, torch.rand(256, 16), ts, torch.rand(256, 16), T(40, dtype=torch.int64))
    if model == "awhr_profile_selector_1_0_1":
        ts = torch.arange(256, dtype=torch.int64) + 1_700_000_000
        return (ts, torch.rand(256, 16, dtype=torch.float64), ts, torch.rand(256, 16, dtype=torch.float64), T(40, dtype=torch.int64))
    if model in ("sleepnet_bdi_0_3_0", "sleepnet_bdi_0_4_0"):
        # bedtime_input = [start_ms, end_ms] int64; ibi_input = [N, 3] float
        # (ibi_ms, ibi_ms, validity=1 in col 2 — validator needs ≥1 valid IBI); ibi_timestamps 1-D int64.
        base = 1_700_000_000_000; nb = 3600
        ts = torch.tensor((np.cumsum([0] + [800] * (nb - 1)) + base).astype("int64"))
        ibi = torch.stack([torch.full((nb,), 800.0), torch.full((nb,), 800.0), torch.full((nb,), 1.0)], dim=1)
        return (torch.tensor([base, base + 8 * 3600 * 1000], dtype=torch.int64), ibi, ts)
    if model == "stress_resilience_2_2_1":
        # Scalar today-contributors (0-100); ms timestamps (forward does /1000); daytime stress
        # 08:00-20:00 non-overlapping the 00:00-07:00 sleep window (omit_sleep_values masks sleep);
        # daily_stress/restorative lists 2-D [13,1], sleep_recovery list 1-D [13] (matches the
        # forward's mixed-dim cat of today's indices). Validator-passing, deterministic.
        MS = 1000; base = 1_700_000_000 * MS
        sts = torch.tensor([base + 8 * 3600 * MS + i * 600 * MS for i in range(72)], dtype=torch.int64)
        return (torch.tensor([base], dtype=torch.int64), torch.tensor([base + 7 * 3600 * MS], dtype=torch.int64),
                T(72.0), T(60.0), T(58.0), T(55.0), T(0.5), T(1.0), T(1.0), T(0.5),
                torch.linspace(-0.6, 0.4, 72), sts,
                torch.full((13, 1), 0.1), torch.full((13, 1), 0.2), torch.full((13,), 0.6))
    if model == "cumulative_stress_1_2_2":
        # 27 inputs: 31-day + 30-day series as (N,1) COLUMNS, within-night trio aligned, ms timestamps
        # inside the sleep window. Contract reverse-engineered from the validator + cluster processor.
        C = lambda n, lo, hi: torch.linspace(lo, hi, n, dtype=torch.float32).unsqueeze(1)
        Cf = lambda n, v: torch.full((n, 1), float(v))
        Ln = lambda n, lo, hi: torch.linspace(lo, hi, n, dtype=torch.float32)
        W, DENSE, bed_ms = 96, 288, 1_700_000_010_000
        tst = torch.arange(DENSE, dtype=torch.int64) * 9000 + bed_ms
        return (C(31,0,2), C(31,48,60), Cf(W,2.0), Ln(300,30,70), C(31,40,60), C(31,50,60), Ln(1,33,35),
                C(30,1.2,1.8), C(31,40,60), C(W,48,60), C(W,0.5,1.0), Cf(DENSE,33.5), C(30,0,50),
                C(30,0.9,1.1), C(30,0.5,1.0), C(30,0,1), C(30,0.6,1.0), C(31,34,35), C(31,-0.2,0.2),
                C(31,0.35,0.45), C(31,6*3600,8*3600), T(14, dtype=torch.int64), T(14, dtype=torch.int64),
                torch.zeros(31,1), torch.zeros(30,1), T(bed_ms, dtype=torch.int64), tst)
    # Everything else: auto-build from the declared forward schema (arg names + types).
    return build_from_schema(m)

def try_forward(m, model):
    args = build(model, m)
    if args is None:
        return None, "no input builder"
    with torch.no_grad():
        out = m.forward(*args)
    # normalize outputs to a dict of arrays
    feeds = {f"in_{i}": (a.numpy() if torch.is_tensor(a) else np.asarray(a)) for i, a in enumerate(args)}
    outs = {}
    if torch.is_tensor(out):
        outs["out_0"] = out.numpy()
    elif isinstance(out, (list, tuple)):
        for i, o in enumerate(out):
            outs[f"out_{i}"] = o.numpy() if torch.is_tensor(o) else np.asarray(o)
    elif isinstance(out, dict):
        for k, o in out.items():
            outs[f"out_{k}"] = o.numpy() if torch.is_tensor(o) else np.asarray(o)
    else:
        outs["out_0"] = np.asarray(out)
    return {**feeds, **outs}, None

def main():
    pts = sorted(f[:-3] for f in os.listdir(PT) if f.endswith(".pt"))
    report = {"captured": [], "skipped": [], "already": []}
    for model in pts:
        if model in ALREADY:
            report["already"].append(model); continue
        path = os.path.join(PT, model + ".pt")
        try:
            m = torch.jit.load(path, map_location="cpu").eval()
        except Exception as e:
            report["skipped"].append({"model": model, "reason": f"load: {str(e)[:120]}"}); continue
        try:
            golden, err = try_forward(m, model)
            if golden is None:
                report["skipped"].append({"model": model, "reason": err}); continue
            np.savez(os.path.join(OUT, model + ".golden.npz"), **golden)
            report["captured"].append(model)
        except Exception as e:
            report["skipped"].append({"model": model, "reason": f"forward: {str(e)[:140]}"})
    with open(os.path.join(OUT, "MANIFEST.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"captured={len(report['captured'])} skipped={len(report['skipped'])} already={len(report['already'])}")
    for m in report["captured"]: print("  OK   ", m)
    for s in report["skipped"]: print("  SKIP ", s["model"], "—", s["reason"])

if __name__ == "__main__":
    main()
