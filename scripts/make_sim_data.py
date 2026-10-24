#!/usr/bin/env python3
"""
make_sim_data.py — generate a labeled SIMULATED task-completion log.

Why: the patterns page needs data to analyse before the user has logged weeks
of real check-ins. This produces fake-but-realistic logs with a KNOWN planted
pattern, so we can both demo the page and later show (in patterns.py) that the
method recovers the pattern we planted.

PLANTED PATTERN (ground truth):
    - "deep work" completion drops sharply on low-recovery (red) days.
    - "reading" is unaffected by recovery.
    - other types sit in between / flat.

Every record carries "simulated": true so it can never be mistaken for real
data. Output matches the app's export shape plus that flag.

Output: data/simulated-logs.json  (committed; clearly simulated)
Standard library only. Deterministic (fixed seed) for a stable demo.
"""

import json
import os
import random
from datetime import date, timedelta

SEED = 7
# A long synthetic history so even the rarer red-tier cells get enough
# observations for the Beta-Binomial difference test to have power. This is
# clearly-labeled simulated data whose only job is to demo + validate the
# method, so a generous sample is fine.
N_DAYS = 400

TASK_TYPES = ["deep work", "reading", "admin", "physical", "social"]

# Ground-truth completion probability by (type, tier). THIS is what the
# analysis in patterns.py should recover. Deep work collapses on red days;
# reading is flat across tiers.
TRUE_COMPLETION = {
    #              green  yellow  red
    "deep work": {"green": 0.88, "yellow": 0.68, "red": 0.38},  # strong drop
    "reading":   {"green": 0.75, "yellow": 0.74, "red": 0.73},  # flat
    "admin":     {"green": 0.78, "yellow": 0.74, "red": 0.72},  # ~flat
    "physical":  {"green": 0.68, "yellow": 0.65, "red": 0.62},  # ~flat
    "social":    {"green": 0.78, "yellow": 0.76, "red": 0.74},  # ~flat
}

# How often each tier occurs (a plausible mix with more normal than extreme).
TIER_MIX = [("green", 0.35), ("yellow", 0.45), ("red", 0.20)]

# Effort guess per type, mirroring the app's tagger.
EFFORT_BY_TYPE = {
    "deep work": 3, "reading": 2, "physical": 2, "admin": 1, "social": 1,
}

# A small pool of task texts per type so logs read naturally.
TEXTS = {
    "deep work": ["write lab report", "code the parser", "problem set 3",
                  "draft thesis section", "debug pipeline"],
    "reading": ["read chapter 4", "review paper", "lecture notes",
                "textbook section"],
    "admin": ["reply to emails", "submit form", "pay bills", "schedule appt"],
    "physical": ["gym session", "morning run", "yoga", "grocery run"],
    "social": ["coffee with Sam", "call family", "lunch with team",
               "study group"],
}


def pick_tier(rng):
    r = rng.random()
    cum = 0.0
    for tier, p in TIER_MIX:
        cum += p
        if r <= cum:
            return tier
    return TIER_MIX[-1][0]


def tier_to_score(tier, rng):
    """A plausible 0-100 score and composite z consistent with the tier.

    Bands: >=67 green, 34..66 yellow, <=33 red. We draw a score in-band and
    back out a rough composite z via the inverse sigmoid, matching score.js.
    """
    import math
    if tier == "green":
        score = rng.randint(67, 92)
    elif tier == "yellow":
        score = rng.randint(37, 63)
    else:
        score = rng.randint(10, 32)
    p = min(max(score / 100.0, 1e-4), 1 - 1e-4)
    z = math.log(p / (1 - p))  # inverse of the sigmoid used in score.js
    return score, round(z, 4)


def build(rng):
    rows = []
    today = date.today()
    start = today - timedelta(days=N_DAYS - 1)

    for i in range(N_DAYS):
        d = (start + timedelta(days=i)).isoformat()
        tier = pick_tier(rng)
        score, z = tier_to_score(tier, rng)

        # 3-5 tasks per day. Sample types WITHOUT replacement when possible so
        # every type shows up regularly across the log (keeps per-cell counts
        # healthy instead of some types being starved by chance).
        n_tasks = rng.randint(3, 5)
        if n_tasks <= len(TASK_TYPES):
            day_types = rng.sample(TASK_TYPES, n_tasks)
        else:
            day_types = list(TASK_TYPES) + [
                rng.choice(TASK_TYPES) for _ in range(n_tasks - len(TASK_TYPES))
            ]

        for t in day_types:
            p_done = TRUE_COMPLETION[t][tier]
            done = rng.random() < p_done
            rows.append({
                "simulated": True,  # never real data
                "date": d,
                "task_text": rng.choice(TEXTS[t]),
                "type": t,
                "effort": EFFORT_BY_TYPE[t],
                "due": "later",
                "recovery_score": score,
                "tier": tier,
                "recovery_z": z,
                "done": done,
            })

    return rows


def main():
    rng = random.Random(SEED)
    rows = build(rng)

    os.makedirs("data", exist_ok=True)
    out_path = os.path.join("data", "simulated-logs.json")
    with open(out_path, "w") as f:
        json.dump(rows, f, indent=2)
        f.write("\n")

    print(f"Wrote {len(rows)} SIMULATED records to {out_path}")
    print("Planted pattern: deep work completion drops on red days; reading flat.")


if __name__ == "__main__":
    main()
