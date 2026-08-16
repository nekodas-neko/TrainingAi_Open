#!/usr/bin/env python3
"""Stage-verify oracle for the cumulative_stress_1_2_2 TS port.

Runs the scripted .pt on the golden inputs, confirms the 19 outputs reproduce the
golden vector, and dumps the Preprocessor.preprocess (18 outputs) and
Processor.estimate intermediates so the TS port can be diffed stage-by-stage.

Not committed as a build artifact — a scratch oracle (the .pt is gitignored).
"""
import sys, json
import numpy as np
import torch

torch.set_grad_enabled(False)

NPZ = "lib/oura-models/goldens/cumulative_stress_1_2_2.golden.npz"
PT = "lib/oura-models/pt/cumulative_stress_1_2_2.pt"

d = np.load(NPZ)


def feed(i):
    a = d[f"in_{i}"]
    return torch.from_numpy(a.copy())


def feeds():
    return [feed(i) for i in range(27)]


def as_list(t):
    return np.asarray(t).reshape(-1).tolist()


m = torch.jit.load(PT, map_location="cpu").eval()

# 1) Reproduce the golden end-to-end.
out = m(*feeds())
maxerr = 0.0
for i, o in enumerate(out):
    got = np.asarray(o).reshape(-1)
    exp = d[f"out_{i}"].reshape(-1)
    e = np.nanmax(np.abs(got - exp)) if got.size else 0.0
    e = 0.0 if np.isnan(e) else e
    maxerr = max(maxerr, e)
    print(f"out_{i}: shape={list(o.shape)} maxerr={e:.2e} got={[round(float(x),4) for x in got[:6]]}")
print(f"\nEND-TO-END max abs err vs golden = {maxerr:.3e}\n")

# 2) Dump Preprocessor.preprocess intermediates (mirror the forward pre-processing).
f = feeds()
(got_ups, lowest_heart_rate, sleep_phase_30_sec, hrv_items, average_hrv,
 resting_hr_average, temperature_avg, average_met_minutes, long_sleep_hrv,
 hrv_medianHR_5min, hrv_quality_5min, temp_skin, sleep_fragmentation_index,
 norm_hrv_medianHR_5min, median_hrv_quality_5min, normalised_iqr, norm_temp_wake,
 highest_temperature, temperature_dev, temperature_dev_baseline,
 total_sleep_duration, n_days_to_ovulation, n_days_to_period, cycle_phase,
 interpreted_cycle_phase, bedtime_start, temp_skin_timestamps) = f

# pre-clean
hrv_medianHR_5min[hrv_medianHR_5min < 1] = float("nan")
bedtime_start0 = torch.floor_divide(bedtime_start, 1000).to(torch.int64)
temp_skin_timestamps0 = torch.floor_divide(temp_skin_timestamps, 1000).to(torch.int64)

fin, latest = m.determine_cycle_phase(interpreted_cycle_phase, cycle_phase, n_days_to_ovulation, n_days_to_period)
lpc = float(m.luteal_phase_correction)
temperature_dev_limit = temperature_dev_baseline + fin * lpc

pp = m.preprocessor.preprocess(
    got_ups, lowest_heart_rate, sleep_phase_30_sec, hrv_items, average_hrv,
    resting_hr_average, temperature_avg, average_met_minutes, long_sleep_hrv,
    hrv_medianHR_5min, hrv_quality_5min, temp_skin, highest_temperature,
    temperature_dev, temperature_dev_limit, total_sleep_duration,
    bedtime_start0, temp_skin_timestamps0)

pp_names = ["got_ups", "lowest_heart_rate", "average_hrv", "resting_hr_average",
            "temperature_avg", "average_met_minutes", "long_sleep_hrv", "norm_hr_min",
            "sleep_fragmentation_index_latest", "norm_hrv_medianHR_5min_latest",
            "median_hrv_quality_5min_latest", "normalised_iqr_latest",
            "medianbaseline_ratio_nhrv", "norm_temp_wake_latest",
            "total_sleep_duration", "fever_mask_31", "hrv_coverage", "sufficient_sleep_check"]

dump = {"cycle": {"final_interpreted_cycle_phase": as_list(fin),
                  "interpreted_cycle_phase_latest": float(latest),
                  "temperature_dev_limit": as_list(temperature_dev_limit)},
        "preprocess": {}}
print("=== Preprocessor.preprocess ===")
for name, val in zip(pp_names, pp):
    if isinstance(val, int):
        dump["preprocess"][name] = val
        print(f"{name}: (int) {val}")
    else:
        lst = as_list(val)
        dump["preprocess"][name] = lst
        head = [round(x, 5) if x == x else None for x in lst[:6]]
        print(f"{name}: shape={list(val.shape)} n={len(lst)} head={head}")

# 3) Dump Processor.estimate intermediates.
(got_ups0, lowest_heart_rate0, average_hrv0, resting_hr_average0, temperature_avg0,
 average_met_minutes0, long_sleep_hrv0, norm_hr_min, sfi_latest, nhrv_latest,
 mhq_latest, niqr_latest, mbr_nhrv, ntw_latest, tsd0, fever_mask_31, hrv_cov,
 suff) = pp

sfi_series = torch.cat([sleep_fragmentation_index, sfi_latest]) / 100
nhrv_series = torch.cat([norm_hrv_medianHR_5min, nhrv_latest])
mhq_series = torch.cat([median_hrv_quality_5min, mhq_latest])
niqr_series = torch.cat([normalised_iqr, niqr_latest])
ntw_series = torch.cat([norm_temp_wake, ntw_latest])

est = m.processor.estimate(got_ups0, tsd0, norm_hr_min, sfi_series, nhrv_series,
                           mhq_series, average_met_minutes0, niqr_series, mbr_nhrv, ntw_series)
pos_proba, scaled_contribs, cluster_proba = est
print("\n=== Processor.estimate ===")
print("positive_cluster_proba:", float(pos_proba), "score=round(*100):", round(float(pos_proba) * 100))
print("scaled_contributors:", [round(x, 5) for x in as_list(scaled_contribs)])
print("cluster_proba:", [round(x, 6) for x in as_list(cluster_proba)])

dump["estimate"] = {"positive_cluster_proba": float(pos_proba),
                    "scaled_contributors": as_list(scaled_contribs),
                    "cluster_proba": as_list(cluster_proba)}


# --- Reference python impls of utils (double as the TS port spec) ---
def torch_median_true(t):
    """TRUE median (avg of the two middle values on even n) over non-NaN values."""
    v = t.reshape(-1)
    v = v[~torch.isnan(v)]
    if v.numel() == 0:
        return float("nan")
    mx = v.max().reshape(-1)
    return float((torch.median(torch.cat([v, mx])) + torch.median(v)) / 2)


# utils.py's torch_huber seeds mu from torch_median (the TRUE-median helper). Rebuild X
# both ways (true-median seed vs torch.median lower-middle seed) to pin which the .pt uses.
def build_X(use_true_median_seed):
    def med(series):
        return torch_median_true(series)

    def huber_scale():
        v = got_ups0.reshape(-1)
        v = v[~torch.isnan(v)]
        if use_true_median_seed:
            mu = torch.tensor([torch_median_true(v)])
        else:
            mu = torch.median(v).reshape(-1)
        scale = torch.std(v)
        p90 = torch.quantile(v, torch.tensor(0.9))
        r80 = p90 - torch.quantile(v, torch.tensor(0.1))
        outlier_scale = torch.max(torch.stack([scale, r80]))
        keep = (v <= mu + outlier_scale * 3.4) | (v < p90 + 7)
        vv = v[keep]
        it = 0
        while True:
            if scale < 1e-8:
                break
            abs_resid = torch.abs(vv - mu)
            threshold = scale * 1.5
            weights = torch.where(abs_resid <= threshold, torch.tensor(1.0), threshold / (abs_resid + 1e-8))
            mu1 = torch.sum(weights * vv) / torch.sum(weights)
            residuals = vv - mu1
            scale_new = torch.sqrt(torch.sum(weights * residuals ** 2) / torch.sum(weights))
            conv = torch.abs(scale_new - scale) < 1e-5
            mu = mu1
            it += 1
            if conv:
                scale = scale_new
                break
            scale = scale_new
            if it >= 50:
                break
        return float(scale)

    ng = huber_scale() / (float(torch.nanmean(tsd0.reshape(-1))) / 60 / 60)
    X = [ng, med(norm_hr_min), med(sfi_series), med(nhrv_series), med(mhq_series),
         med(average_met_minutes0), med(niqr_series), med(mbr_nhrv), med(ntw_series)]
    return X


for seed_flag, label in [(True, "true-median-seed"), (False, "torch.median-seed")]:
    X = build_X(seed_flag)
    Xt = torch.tensor(X, dtype=torch.float32).reshape(1, 9)
    fa = m.processor.factor_analysis_transform(Xt)
    fa2 = m.processor.factor_analysis_drop_dim(fa, int(m.processor.dim_to_drop))
    pp2, cp2 = m.processor.estimate_cluster_proba(fa2)
    sc2 = m.processor.scale_contributors(fa2)
    ok = abs(float(pp2) - float(pos_proba)) < 1e-4
    print(f"\n[{label}] X={[round(x,5) for x in X]}")
    print(f"  fa_output(6)={[round(x,5) for x in as_list(fa)]}")
    print(f"  fa_dropped(5)={[round(x,5) for x in as_list(fa2)]}")
    print(f"  pos_proba={float(pp2):.6f} (target {float(pos_proba):.6f}) match={ok}")
    if ok:
        dump["estimate"]["X"] = X
        dump["estimate"]["fa_output"] = as_list(fa)
        dump["estimate"]["fa_dropped"] = as_list(fa2)
        dump["estimate"]["huber_median_seed"] = label

json.dump(dump, open("/tmp/claude-scratch-cs-intermediates.json", "w"), indent=1)
print("\nDumped intermediates to /tmp/claude-scratch-cs-intermediates.json")

