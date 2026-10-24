#!/usr/bin/env python3
"""
insights.py — sleep -> next-morning HRV analysis (REFERENCE for js/insights-core.js).

This mirrors js/insights-core.js field-for-field: same shared mulberry32 PRNG,
same Neumaier summation, same baseline-adjusted HRV, same 3-night sleep-debt
time-ordered CV, same rounding. The parity test asserts JS == this on the
sample dataset.

Privacy: reads data/daily.json (real, git-ignored) OR a sample path; writes ONLY
aggregate results. Real insights.json/.js are git-ignored; only sample output is
committed.

Standard library only (no numpy) so the PRNG/summation match JS exactly.
"""

import json
import math
import os
import sys

# --- Constants (pinned; mirrored in js/insights-core.js) -----------------
SEED = 0x9E3779B9
BASELINE_DAYS = 30
MIN_BASELINE_HISTORY = 7
MIN_PAIRS = 10
BOOT_ITERS = 5000
CV_FOLDS = 5
NEGLIGIBLE_RMSE = 0.1
SHORT_SLEEP_H = 7
RHR_RANGE = (60, 100)
MIN_SEG_DAYS = 60
STEP_FACTOR = 1.0
CONTEXT_COUNTY = "Suffolk"
MASK = 0xFFFFFFFF


# --- Shared PRNG: mulberry32 (identical stream to JS) --------------------
def _imul(a, b):
    return (a * b) & MASK


def make_rng(seed):
    state = seed & MASK

    def rng():
        nonlocal state
        state = (state + 0x6D2B79F5) & MASK
        t = state
        t = _imul(t ^ (t >> 15), t | 1) & MASK
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & MASK
        t &= MASK
        return ((t ^ (t >> 14)) & MASK) / 4294967296

    return rng


# --- Summation / stats (Neumaier; no numpy) ------------------------------
def neumaier_sum(values):
    s = 0.0
    c = 0.0
    for x in values:
        t = s + x
        if abs(s) >= abs(x):
            c += (s - t) + x
        else:
            c += (x - t) + s
        s = t
    return s + c


def mean(values):
    return neumaier_sum(values) / len(values) if values else float("nan")


def pearson_r(x, y):
    n = len(x)
    if n < 2:
        return float("nan")
    mx, my = mean(x), mean(y)
    dx = [xi - mx for xi in x]
    dy = [yi - my for yi in y]
    cov = neumaier_sum([dx[i] * dy[i] for i in range(n)])
    vx = neumaier_sum([d * d for d in dx])
    vy = neumaier_sum([d * d for d in dy])
    denom = math.sqrt(vx * vy)
    if denom == 0:
        return float("nan")
    r = cov / denom
    # Clamp tiny floating-point overshoot; Pearson r is defined on [-1, 1].
    return max(-1.0, min(1.0, r))


def ols_slope_intercept(x, y):
    n = len(x)
    mx, my = mean(x), mean(y)
    num = neumaier_sum([(x[i] - mx) * (y[i] - my) for i in range(n)])
    den = neumaier_sum([(x[i] - mx) * (x[i] - mx) for i in range(n)])
    slope = 0.0 if den == 0 else num / den
    return slope, my - slope * mx


def rmse(pred, actual):
    n = len(pred)
    if n == 0:
        return float("nan")
    return math.sqrt(neumaier_sum([(pred[i] - actual[i]) ** 2 for i in range(n)]) / n)


def quantile(sorted_asc, q):
    n = len(sorted_asc)
    if n == 0:
        return float("nan")
    if n == 1:
        return sorted_asc[0]
    pos = q * (n - 1)
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_asc[lo]
    frac = pos - lo
    return sorted_asc[lo] * (1 - frac) + sorted_asc[hi] * frac


def round_n(x, nd):
    # Python's built-in round already does banker's rounding on the double;
    # js insights-core.roundN replicates exactly that. So use round() here.
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return x
    return round(x, nd)


# --- Dates ----------------------------------------------------------------
def to_ordinal(iso):
    from datetime import date
    y, m, d = (int(v) for v in iso.split("-"))
    return date(y, m, d).toordinal()


def iso_from_ordinal(ordv):
    from datetime import date
    return date.fromordinal(ordv).isoformat()


# --- Baseline-adjusted HRV + pairing -------------------------------------
def baseline_adjusted_by_date(rows):
    sorted_rows = sorted(rows, key=lambda r: r["date"])
    adj = {}
    for r in sorted_rows:
        if not isinstance(r.get("hrv"), (int, float)):
            continue
        ord_i = to_ordinal(r["date"])
        prior = []
        for rj in sorted_rows:
            if not isinstance(rj.get("hrv"), (int, float)):
                continue
            oj = to_ordinal(rj["date"])
            if oj < ord_i and oj >= ord_i - BASELINE_DAYS:
                prior.append(rj["hrv"])
        if len(prior) < MIN_BASELINE_HISTORY:
            continue
        adj[r["date"]] = r["hrv"] - mean(prior)
    return adj


def build_pairs(rows):
    by_date = {r["date"]: r for r in rows}
    adj = baseline_adjusted_by_date(rows)
    sorted_rows = sorted(rows, key=lambda r: r["date"])
    pairs = []
    for r in sorted_rows:
        s = r.get("sleep_h")
        if not isinstance(s, (int, float)):
            continue
        next_iso = iso_from_ordinal(to_ordinal(r["date"]) + 1)
        if next_iso not in adj:
            continue
        n1 = by_date.get(r["date"])
        n2 = by_date.get(iso_from_ordinal(to_ordinal(r["date"]) - 1))
        n3 = by_date.get(iso_from_ordinal(to_ordinal(r["date"]) - 2))
        debt = None
        if (n1 and n2 and n3 and isinstance(n1.get("sleep_h"), (int, float))
                and isinstance(n2.get("sleep_h"), (int, float))
                and isinstance(n3.get("sleep_h"), (int, float))):
            debt = n1["sleep_h"] + n2["sleep_h"] + n3["sleep_h"]
        pairs.append({"date": next_iso, "sleep": float(s), "adj_hrv": adj[next_iso], "debt3n": debt})
    pairs.sort(key=lambda p: p["date"])
    return pairs


# --- Device-change --------------------------------------------------------
def sample_var(vals):
    n = len(vals)
    if n < 2:
        return 0.0
    m = mean(vals)
    return neumaier_sum([(v - m) ** 2 for v in vals]) / (n - 1)


def detect_device_change(rows):
    series = sorted(
        [(r["date"], float(r["hrv"])) for r in rows if isinstance(r.get("hrv"), (int, float))],
        key=lambda t: t[0],
    )
    n = len(series)
    if n < 2 * MIN_SEG_DAYS:
        return {"changed": False, "boundary_date": None, "segments": []}
    vals = [v for _, v in series]
    best = {"score": 0.0, "idx": None}
    for i in range(MIN_SEG_DAYS, n - MIN_SEG_DAYS):
        left, right = vals[:i], vals[i:]
        pooled = math.sqrt(
            (sample_var(left) * (len(left) - 1) + sample_var(right) * (len(right) - 1)) / (n - 2)
        )
        if pooled == 0:
            continue
        score = abs(mean(right) - mean(left)) / pooled
        if score > best["score"]:
            best = {"score": score, "idx": i}
    if best["idx"] is None or best["score"] < STEP_FACTOR:
        return {"changed": False, "boundary_date": None, "segments": []}
    i = best["idx"]
    lv, rv = vals[:i], vals[i:]
    return {
        "changed": True,
        "boundary_date": series[i][0],
        "step_sd_units": round_n(best["score"], 2),
        "segments": [
            {"from": series[0][0], "to": series[i - 1][0], "n": len(lv), "mean_hrv": round_n(mean(lv), 1)},
            {"from": series[i][0], "to": series[-1][0], "n": len(rv), "mean_hrv": round_n(mean(rv), 1)},
        ],
    }


# --- Slope + bootstrap CI -------------------------------------------------
def analyze_window(pairs, rng):
    n = len(pairs)
    if n < MIN_PAIRS:
        return {"n_pairs": n, "enough": False}
    sleep = [p["sleep"] for p in pairs]
    hrv = [p["adj_hrv"] for p in pairs]
    r = pearson_r(sleep, hrv)
    slope, intercept = ols_slope_intercept(sleep, hrv)
    slopes = []
    for _ in range(BOOT_ITERS):
        rs = []
        rh = []
        for _k in range(n):
            idx = int(rng() * n)
            rs.append(sleep[idx])
            rh.append(hrv[idx])
        slopes.append(ols_slope_intercept(rs, rh)[0])
    slopes.sort()
    lo = quantile(slopes, 0.025)
    hi = quantile(slopes, 0.975)
    return {
        "n_pairs": n,
        "enough": True,
        "pearson_r": round_n(r, 3),
        "slope_ms_per_hour": round_n(slope, 2),
        "intercept": round_n(intercept, 2),
        "slope_ci_low": round_n(lo, 2),
        "slope_ci_high": round_n(hi, 2),
        "slope_excludes_zero": bool(lo > 0 or hi < 0),
        "date_from": pairs[0]["date"],
        "date_to": pairs[-1]["date"],
    }


# --- Sleep-debt CV --------------------------------------------------------
def fold_slices(n, k):
    base, rem = divmod(n, k)
    slices = []
    start = 0
    for f in range(k):
        size = base + (1 if f >= k - rem else 0)
        slices.append((start, start + size))
        start += size
    return slices


def cv_rmse(feature, target):
    n = len(feature)
    if n < CV_FOLDS:
        return None
    slices = fold_slices(n, CV_FOLDS)
    fold_rmses = []
    for f in range(1, CV_FOLDS):
        ts, te = slices[f]
        trx, trv = feature[:ts], target[:ts]
        tex, tev = feature[ts:te], target[ts:te]
        if len(trx) < 2 or len(tex) == 0:
            continue
        slope, intercept = ols_slope_intercept(trx, trv)
        pred = [slope * xv + intercept for xv in tex]
        fold_rmses.append(rmse(pred, tev))
    if not fold_rmses:
        return None
    return mean(fold_rmses)


def sleep_debt_comparison(pairs):
    last_x = [p["sleep"] for p in pairs]
    last_y = [p["adj_hrv"] for p in pairs]
    debt_pairs = [p for p in pairs if isinstance(p["debt3n"], (int, float))]
    debt_x = [p["debt3n"] for p in debt_pairs]
    debt_y = [p["adj_hrv"] for p in debt_pairs]
    if len(pairs) < CV_FOLDS or len(debt_pairs) < CV_FOLDS:
        return {"enough": False, "n_pairs": len(pairs), "n_debt_pairs": len(debt_pairs)}
    rl = cv_rmse(last_x, last_y)
    rd = cv_rmse(debt_x, debt_y)
    if rl is None or rd is None:
        return {"enough": False, "n_pairs": len(pairs), "n_debt_pairs": len(debt_pairs)}
    diff = abs(rl - rd)
    verdict = "negligible" if diff <= NEGLIGIBLE_RMSE else ("last_night" if rl < rd else "sleep_debt")
    return {
        "enough": True,
        "rmse_last_night": round_n(rl, 2),
        "rmse_sleep_debt": round_n(rd, 2),
        "verdict": verdict,
        "n_pairs": len(pairs),
        "n_debt_pairs": len(debt_pairs),
    }


# --- Reference ------------------------------------------------------------
def short_sleep_share(rows):
    nights = [r for r in rows if isinstance(r.get("sleep_h"), (int, float))]
    if not nights:
        return None
    short = sum(1 for r in nights if r["sleep_h"] < SHORT_SLEEP_H)
    return {"share": round_n(short / len(nights), 3), "n_nights": len(nights), "short_nights": short}


def resting_hr_context(rows):
    vals = [r["rhr"] for r in rows if isinstance(r.get("rhr"), (int, float))]
    if not vals:
        return None
    return {"mean_rhr": round_n(mean(vals), 1), "adult_range_low": RHR_RANGE[0], "adult_range_high": RHR_RANGE[1], "n": len(vals)}


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


def compute_insights(rows, cdc, seed=SEED):
    device = detect_device_change(rows)
    pairs = build_pairs(rows)
    full = analyze_window(pairs, make_rng(seed))
    analysis_window = "full"
    recent = None
    if device["changed"]:
        boundary = device["boundary_date"]
        kept = [p for p in pairs if p["date"] >= boundary]
        if len(kept) >= MIN_PAIRS:
            recent = analyze_window(kept, make_rng(seed + 1))
            analysis_window = "recent_segment"
    primary = recent if (recent and recent.get("enough")) else full
    cv_pairs = [p for p in pairs if p["date"] >= device["boundary_date"]] if analysis_window == "recent_segment" else pairs
    return {
        "n_pairs_total": full.get("n_pairs", 0),
        "device_change": device,
        "analysis_window": analysis_window,
        "primary": primary,
        "full_history": full,
        "recent_segment": recent,
        "sleep_debt": sleep_debt_comparison(cv_pairs),
        "reference": {
            "short_sleep": short_sleep_share(rows),
            "resting_hr": resting_hr_context(rows),
            "cdc_context": cdc,
            "recommended_sleep_h": SHORT_SLEEP_H,
            "hrv_norm_comparison": False,
            "hrv_note": "Between-person HRV variation is large and wearable HRV is not comparable to clinical norms, so only your own baseline is used.",
        },
        "note": "Lagged association from one person's own history. Correlation is not causation; this is a personal planning aid, not medical advice.",
    }


def main(argv):
    daily_path = argv[1] if len(argv) > 1 else os.path.join("data", "daily.json")
    cdc_path = os.path.join("data", "cdc-short-sleep-ma.json")
    if not os.path.exists(daily_path):
        print(f"Need {daily_path}.", file=sys.stderr)
        return 1
    with open(daily_path) as f:
        rows = json.load(f)
    cdc = cdc_context(cdc_path, CONTEXT_COUNTY)
    out = compute_insights(rows, cdc)

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
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
