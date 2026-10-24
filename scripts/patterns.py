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
import os
import sys

import numpy as np
from scipy import stats

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


def cell_posterior(done, n, prior_mean, k0):
    """Return the Beta posterior (alpha, beta) for one cell."""
    alpha = prior_mean * k0 + done
    beta = (1 - prior_mean) * k0 + (n - done)
    return alpha, beta


def beta_binomial_cell(done, n, prior_mean, k0):
    """Posterior mean + credible interval for one cell."""
    alpha, beta = cell_posterior(done, n, prior_mean, k0)
    mean = alpha / (alpha + beta)
    lo = stats.beta.ppf(CI_LO, alpha, beta)
    hi = stats.beta.ppf(CI_HI, alpha, beta)
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


def difference_excludes_zero(green_cell, red_cell, rng):
    """Does the posterior of (green_rate - red_rate) credibly exclude zero?

    We sample both Beta posteriors and look at the distribution of the
    difference. "Drops on low days" means green completion is credibly higher
    than red: the CI_MASS interval of (green - red) lies entirely above 0.
    Returns (drops: bool, diff_mean, diff_lo, diff_hi, prob_green_higher).
    """
    n_samp = 20000
    g = rng.beta(green_cell["_alpha"], green_cell["_beta"], n_samp)
    r = rng.beta(red_cell["_alpha"], red_cell["_beta"], n_samp)
    diff = g - r
    lo = float(np.quantile(diff, CI_LO))
    hi = float(np.quantile(diff, CI_HI))
    drops = lo > 0.0  # whole credible interval above zero
    return {
        "diff_mean": round(float(diff.mean()), 4),
        "diff_ci_low": round(lo, 4),
        "diff_ci_high": round(hi, 4),
        "prob_green_higher": round(float((diff > 0).mean()), 4),
        "drops": bool(drops),
    }


def analyze(rows, rng):
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
            diff = difference_excludes_zero(green, red, rng)
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

    rng = np.random.default_rng(0)  # fixed seed so results are reproducible
    analysis = analyze(rows, rng)
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
