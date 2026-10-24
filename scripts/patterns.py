#!/usr/bin/env python3
"""
patterns.py — Beta-Binomial completion rates by task type x recovery tier.

For each (task type, recovery tier) we estimate the probability the user
completes that kind of task, with a credible interval. Cells with little data
are shrunk toward the user's OVERALL completion rate, so a 1-of-1 day doesn't
read as "100% reliable".

Method (empirical-Bayes Beta-Binomial):
    - Overall rate m = total_done / total_tasks sets the prior mean.
    - A prior "strength" k0 (pseudo-count) controls shrinkage: prior is
      Beta(m*k0, (1-m)*k0). Small n -> estimate stays near m; large n -> data
      dominates.
    - Posterior for a cell with `done` of `n` is
      Beta(m*k0 + done, (1-m)*k0 + (n-done)).
    - Point estimate = posterior mean; interval = 94% credible interval from
      the Beta quantiles.

We also run a RECOVERY TEST: because the simulated data has a known planted
pattern, we check that the method flags "deep work" as dropping on red days
(its red interval sits below its green interval) and does NOT flag "reading".

Reads:  data/simulated-logs.json  (or a path passed as argv[1])
Writes: data/patterns.json        (what patterns.js renders)

Requires numpy + scipy (see requirements.txt).
"""

import json
import math
import os
import sys

TIERS = ["green", "yellow", "red"]

# Prior strength in pseudo-observations. ~8 means a cell needs several real
# observations before it pulls away from the overall rate. Tunable.
PRIOR_STRENGTH = 8.0

# Credible interval mass.
CI_MASS = 0.94
CI_LO = (1 - CI_MASS) / 2
CI_HI = 1 - CI_LO


def load_logs(path):
    with open(path) as f:
        rows = json.load(f)
    # Keep only rows with a usable tier and boolean done.
    return [
        r for r in rows
        if r.get("tier") in TIERS and isinstance(r.get("done"), bool)
    ]


def overall_rate(rows):
    if not rows:
        return 0.5
    done = sum(1 for r in rows if r["done"])
    return done / len(rows)


# --- Deterministic Beta math (mirrors js/patterns-core.js exactly) ---------
GRID = 1000  # difference-grid resolution, shared with the JS core


def _betacf(x, a, b):
    MAXIT, EPS, FPMIN = 200, 3e-12, 1e-300
    qab, qap, qam = a + b, a + 1, a - 1
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < FPMIN:
        d = FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        delv = d * c
        h *= delv
        if abs(delv - 1.0) < EPS:
            break
    return h


def betacdf(x, a, b):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbeta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    bt = math.exp(a * math.log(x) + b * math.log(1 - x) - lbeta)
    if x < (a + 1) / (a + b + 2):
        return bt * _betacf(x, a, b) / a
    return 1 - bt * _betacf(1 - x, b, a) / b


def betappf(p, a, b):
    if p <= 0:
        return 0.0
    if p >= 1:
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if betacdf(mid, a, b) < p:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def cell_posterior(done, n, prior_mean, k0):
    alpha = prior_mean * k0 + done
    beta = (1 - prior_mean) * k0 + (n - done)
    return alpha, beta


def beta_binomial_cell(done, n, prior_mean, k0):
    alpha, beta = cell_posterior(done, n, prior_mean, k0)
    mean = alpha / (alpha + beta)
    lo = betappf(CI_LO, alpha, beta)
    hi = betappf(CI_HI, alpha, beta)
    return {
        "n": n,
        "done": done,
        "raw_rate": round(done / n, 4) if n > 0 else None,
        "estimate": round(float(mean), 4),
        "ci_low": round(float(lo), 4),
        "ci_high": round(float(hi), 4),
        "_alpha": alpha,
        "_beta": beta,
    }


def _beta_pdf_grid(a, b):
    lbeta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    pdf = [0.0] * (GRID + 1)
    total = 0.0
    for i in range(GRID + 1):
        x = i / GRID
        if x <= 0 or x >= 1:
            v = 0.0
        else:
            v = math.exp((a - 1) * math.log(x) + (b - 1) * math.log(1 - x) - lbeta)
        pdf[i] = v
        total += v
    for i in range(GRID + 1):
        pdf[i] /= total
    return pdf


def difference_excludes_zero(green_cell, red_cell):
    """Deterministic (no sampling) credible interval of (green - red).

    Discretize both Beta posteriors on the shared grid and convolve to get the
    difference distribution; read the CI_MASS interval and whether it is > 0.
    Identical arithmetic to js/patterns-core.js differenceInterval().
    """
    g = _beta_pdf_grid(green_cell["_alpha"], green_cell["_beta"])
    r = _beta_pdf_grid(red_cell["_alpha"], red_cell["_beta"])
    diff = [0.0] * (2 * GRID + 1)
    for i in range(GRID + 1):
        gi = g[i]
        if gi == 0.0:
            continue
        for k in range(GRID + 1):
            diff[i - k + GRID] += gi * r[k]
    cum = 0.0
    lo = None
    hi = None
    mean_acc = 0.0
    prob_pos = 0.0
    for d in range(2 * GRID + 1):
        val = (d - GRID) / GRID
        mean_acc += val * diff[d]
        if val > 0:
            prob_pos += diff[d]
        cum += diff[d]
        if lo is None and cum >= CI_LO:
            lo = val
        if hi is None and cum >= CI_HI:
            hi = val
    if lo is None:
        lo = -1.0
    if hi is None:
        hi = 1.0
    return {
        "diff_mean": round(float(mean_acc), 4),
        "diff_ci_low": round(float(lo), 4),
        "diff_ci_high": round(float(hi), 4),
        "prob_green_higher": round(float(prob_pos), 4),
        "drops": bool(lo > 0.0),
    }


def analyze(rows):
    m = overall_rate(rows)
    types = sorted({r["type"] for r in rows})

    # Count done/total per (type, tier).
    cells = {t: {tier: [0, 0] for tier in TIERS} for t in types}
    for r in rows:
        c = cells[r["type"]][r["tier"]]
        c[1] += 1            # total
        if r["done"]:
            c[0] += 1        # done

    result_types = {}
    for t in types:
        per_tier = {}
        for tier in TIERS:
            done, n = cells[t][tier]
            per_tier[tier] = beta_binomial_cell(done, n, m, PRIOR_STRENGTH)

        green = per_tier["green"]
        red = per_tier["red"]
        # A type "drops on low days" when the posterior of (green - red)
        # completion credibly excludes zero — your "CI excludes no effect".
        if green["n"] > 0 and red["n"] > 0:
            diff = difference_excludes_zero(green, red)
        else:
            diff = {
                "diff_mean": None, "diff_ci_low": None, "diff_ci_high": None,
                "prob_green_higher": None, "drops": False,
            }

        # Drop the internal posterior params before serialising.
        for tier in TIERS:
            per_tier[tier].pop("_alpha", None)
            per_tier[tier].pop("_beta", None)

        result_types[t] = {
            "tiers": per_tier,
            "green_minus_red": diff,
            "drops_on_low": bool(diff["drops"]),
        }

    return {
        "overall_rate": round(float(m), 4),
        "prior_strength": PRIOR_STRENGTH,
        "ci_mass": CI_MASS,
        "types": result_types,
    }


def recovery_test(analysis):
    """Confirm the method recovers the planted pattern in the simulated data.

    Expect: deep work flagged as dropping on low days; reading NOT flagged.
    Returns a dict describing pass/fail so it can be shown in the pitch.
    """
    types = analysis["types"]
    checks = []

    def flagged(name):
        return name in types and types[name]["drops_on_low"]

    dw_ok = flagged("deep work")
    checks.append({
        "name": "deep work drops on low days",
        "expected": True,
        "observed": dw_ok,
        "pass": dw_ok is True,
    })

    reading_ok = not flagged("reading")
    checks.append({
        "name": "reading does NOT drop on low days",
        "expected": True,
        "observed": reading_ok,
        "pass": reading_ok is True,
    })

    return {
        "all_pass": all(c["pass"] for c in checks),
        "checks": checks,
    }


def main(argv):
    in_path = argv[1] if len(argv) > 1 else os.path.join("data", "simulated-logs.json")
    if not os.path.exists(in_path):
        print(f"Input not found: {in_path}. Run make_sim_data.py first.",
              file=sys.stderr)
        return 1

    rows = load_logs(in_path)
    simulated = bool(rows) and all(r.get("simulated") for r in rows)

    analysis = analyze(rows)
    test = recovery_test(analysis) if simulated else None

    out = {
        "simulated": simulated,
        "n_records": len(rows),
        "source": os.path.basename(in_path),
        "analysis": analysis,
        "recovery_test": test,
        "demotable_types": [
            t for t, info in analysis["types"].items() if info["drops_on_low"]
        ],
    }

    out_path = os.path.join("data", "patterns.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    # Also emit a JS global so the page can load it via a <script> tag and work
    # when index.html is opened as a file:// URL (fetch of local JSON is blocked).
    js_path = os.path.join("data", "patterns.js")
    with open(js_path, "w") as f:
        f.write("// Generated by scripts/patterns.py. Renders on the patterns page.\n")
        f.write("window.HUIFAN_PATTERNS = ")
        json.dump(out, f, indent=2)
        f.write(";\n")

    print(f"Wrote {out_path} and {js_path} from {len(rows)} records "
          f"(simulated={simulated}).")
    if test is not None:
        status = "PASS" if test["all_pass"] else "FAIL"
        print(f"Recovery test: {status}")
        for c in test["checks"]:
            print(f"  [{'ok' if c['pass'] else 'XX'}] {c['name']}")
    print(f"Demotable types (proven to drop on low days): "
          f"{out['demotable_types']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
