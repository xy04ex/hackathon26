#!/usr/bin/env python3
"""
insights.py — sleep -> next-morning HRV analysis from the user's real data.

Privacy: this reads data/daily.json (real, git-ignored) but writes ONLY
aggregate results to data/insights.json (committed). No raw daily values ever
leave this script.

What it computes:
  1. Pairs: night N's sleep hours joined to morning N+1's HRV, keeping only
     pairs where BOTH exist. Reports the pair count.
  2. Pearson correlation between previous-night sleep and next-day HRV.
  3. OLS regression next_day_hrv ~ prev_night_sleep: the slope is "ms of HRV
     per extra hour of sleep", with a bootstrap 95% CI (resample pairs).
  4. Device-change check: HRV SDNN can jump when the watch changes (different
     algorithm). We detect a sustained step change in HRV level; if found, we
     restrict the analysis to the most recent consistent segment and flag it.
  5. CDC context line (Suffolk County) read from the committed CDC file.

Reads:  data/daily.json  (real; not committed)
        data/cdc-short-sleep-ma.json  (committed CDC data)
Writes: data/insights.json and data/insights.js  (aggregates only, committed)

Requires numpy (see requirements.txt).
"""

import json
import os
import sys
from datetime import date

import numpy as np

# Device-change detection thresholds.
MIN_SEG_DAYS = 60          # a segment must be at least this long to be real
STEP_FACTOR = 1.0          # a split must shift the mean by >= 1 pooled SD
BOOT_ITERS = 5000          # bootstrap resamples for the slope CI
CONTEXT_COUNTY = "Suffolk"  # BU is in Suffolk County


def load_daily(path):
    with open(path) as f:
        return json.load(f)


def parse_date(s):
    y, m, d = (int(x) for x in s.split("-"))
    return date(y, m, d)


def build_pairs(rows):
    """Join night N sleep -> morning N+1 HRV. Returns (dates, sleep, hrv).

    Only consecutive calendar days are paired, and only when both sleep (day N)
    and HRV (day N+1) are present.
    """
    by_date = {r["date"]: r for r in rows}
    dates, sleep, hrv = [], [], []
    for r in rows:
        s = r.get("sleep_h")
        if not isinstance(s, (int, float)):
            continue
        d = parse_date(r["date"])
        nxt = d.toordinal() + 1
        nxt_date = date.fromordinal(nxt).isoformat()
        nr = by_date.get(nxt_date)
        if nr is None:
            continue
        h = nr.get("hrv")
        if not isinstance(h, (int, float)):
            continue
        dates.append(nxt_date)   # label the pair by the HRV (morning) date
        sleep.append(float(s))
        hrv.append(float(h))
    return dates, np.array(sleep), np.array(hrv)


def detect_device_change(rows):
    """Find a sustained step change in HRV level (suggests a device swap).

    Returns dict with {changed: bool, boundary_date: str|None,
    segments: [...]}. We look at the HRV series over time and find the single
    split that maximises the standardized mean difference between the two
    sides, requiring each side to be >= MIN_SEG_DAYS and the shift >= STEP_FACTOR
    pooled SDs. This is a simple, explainable heuristic, not a formal change-
    point model.
    """
    series = [
        (r["date"], float(r["hrv"]))
        for r in rows
        if isinstance(r.get("hrv"), (int, float))
    ]
    series.sort(key=lambda t: t[0])
    n = len(series)
    if n < 2 * MIN_SEG_DAYS:
        return {"changed": False, "boundary_date": None, "segments": []}

    vals = np.array([v for _, v in series])
    best = {"score": 0.0, "idx": None}
    # Scan candidate split indices (respecting the minimum segment length).
    for i in range(MIN_SEG_DAYS, n - MIN_SEG_DAYS):
        left = vals[:i]
        right = vals[i:]
        pooled_sd = np.sqrt(
            (left.var(ddof=1) * (len(left) - 1)
             + right.var(ddof=1) * (len(right) - 1))
            / (n - 2)
        )
        if pooled_sd == 0:
            continue
        score = abs(right.mean() - left.mean()) / pooled_sd
        if score > best["score"]:
            best = {"score": score, "idx": i}

    if best["idx"] is None or best["score"] < STEP_FACTOR:
        return {"changed": False, "boundary_date": None, "segments": []}

    i = best["idx"]
    boundary_date = series[i][0]
    left_vals = vals[:i]
    right_vals = vals[i:]
    return {
        "changed": True,
        "boundary_date": boundary_date,
        "step_sd_units": round(float(best["score"]), 2),
        "segments": [
            {
                "from": series[0][0],
                "to": series[i - 1][0],
                "n": int(len(left_vals)),
                "mean_hrv": round(float(left_vals.mean()), 1),
            },
            {
                "from": series[i][0],
                "to": series[-1][0],
                "n": int(len(right_vals)),
                "mean_hrv": round(float(right_vals.mean()), 1),
            },
        ],
    }


def ols_slope(x, y):
    """Return (slope, intercept) for y ~ x via least squares."""
    A = np.vstack([x, np.ones_like(x)]).T
    slope, intercept = np.linalg.lstsq(A, y, rcond=None)[0]
    return float(slope), float(intercept)


def bootstrap_slope_ci(x, y, iters, rng):
    """Bootstrap 95% CI for the OLS slope by resampling pairs."""
    n = len(x)
    slopes = np.empty(iters)
    for b in range(iters):
        idx = rng.integers(0, n, n)
        s, _ = ols_slope(x[idx], y[idx])
        slopes[b] = s
    lo = float(np.quantile(slopes, 0.025))
    hi = float(np.quantile(slopes, 0.975))
    return lo, hi


def analyze_window(dates, sleep, hrv, rng):
    """Correlation + regression for one set of pairs."""
    n = len(sleep)
    if n < 10:
        return {"n_pairs": n, "enough": False}
    r = float(np.corrcoef(sleep, hrv)[0, 1])
    slope, intercept = ols_slope(sleep, hrv)
    lo, hi = bootstrap_slope_ci(sleep, hrv, BOOT_ITERS, rng)
    return {
        "n_pairs": n,
        "enough": True,
        "pearson_r": round(r, 3),
        "slope_ms_per_hour": round(slope, 2),
        "slope_ci_low": round(lo, 2),
        "slope_ci_high": round(hi, 2),
        "slope_excludes_zero": bool(lo > 0 or hi < 0),
        "date_from": dates[0],
        "date_to": dates[-1],
    }


def cdc_context(cdc_path, county):
    if not os.path.exists(cdc_path):
        return None
    with open(cdc_path) as f:
        cdc = json.load(f)
    match = [c for c in cdc.get("counties", []) if c["county"] == county]
    if not match:
        return None
    c = match[0]
    return {
        "county": county,
        "pct_short_sleep": c["pct_short_sleep"],
        "ci_low": c.get("ci_low"),
        "ci_high": c.get("ci_high"),
        "year": c.get("year"),
        "citation": cdc.get("citation"),
    }


def main(argv):
    daily_path = argv[1] if len(argv) > 1 else os.path.join("data", "daily.json")
    cdc_path = os.path.join("data", "cdc-short-sleep-ma.json")
    if not os.path.exists(daily_path):
        print(f"Need {daily_path} (run parse_health.py first).", file=sys.stderr)
        return 1

    rows = load_daily(daily_path)
    rng = np.random.default_rng(0)

    # 1) Device-change check on the full HRV history.
    device = detect_device_change(rows)

    # 2) Build pairs over the full history, then optionally restrict to the
    #    most recent consistent segment if a device change was detected.
    dates, sleep, hrv = build_pairs(rows)
    full = analyze_window(dates, sleep, hrv, rng)

    recent = None
    analysis_window = "full"
    if device["changed"]:
        boundary = device["boundary_date"]
        keep = [i for i, d in enumerate(dates) if d >= boundary]
        if len(keep) >= 10:
            rd = [dates[i] for i in keep]
            recent = analyze_window(
                rd, sleep[keep], hrv[keep], np.random.default_rng(1)
            )
            analysis_window = "recent_segment"

    primary = recent if (recent and recent.get("enough")) else full

    out = {
        "n_pairs_total": full.get("n_pairs", 0),
        "device_change": device,
        "analysis_window": analysis_window,
        "primary": primary,
        "full_history": full,
        "recent_segment": recent,
        "cdc_context": cdc_context(cdc_path, CONTEXT_COUNTY),
        "note": (
            "Lagged association from one person's own history. Correlation is "
            "not causation; this is a personal planning aid, not medical advice."
        ),
    }

    out_path = os.path.join("data", "insights.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    js_path = os.path.join("data", "insights.js")
    with open(js_path, "w") as f:
        f.write("// Generated by scripts/insights.py. Aggregate results only.\n")
        f.write("window.HUIFAN_INSIGHTS = ")
        json.dump(out, f, indent=2)
        f.write(";\n")

    print(f"Wrote {out_path} and {js_path}")
    print(f"  pairs (total): {full.get('n_pairs')}")
    print(f"  device change: {device['changed']} "
          f"(boundary {device.get('boundary_date')})")
    if primary.get("enough"):
        print(f"  window: {analysis_window}  pairs={primary['n_pairs']}")
        print(f"  r={primary['pearson_r']}  "
              f"slope={primary['slope_ms_per_hour']} ms/h "
              f"[{primary['slope_ci_low']}, {primary['slope_ci_high']}]")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
