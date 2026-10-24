# Requirements — browser-patterns (in-browser Beta-Binomial on the user's logs)

## Introduction
Port the Beta-Binomial completion-rate analysis (scripts/patterns.py) to a pure
JS module (js/patterns-core.js) that runs in the browser on the user's OWN
logged check-in history. For real data, learnedDemotions come only from this
in-browser result, and only once a task type's green-minus-red credible interval
excludes zero. In sample mode we keep using the committed simulated patterns so
the demo still shows the full loop. Parity with patterns.py is proven on the
simulated logs.

Decision (locked): the green-minus-red "excludes zero" decision is computed
DETERMINISTICALLY (no Monte-Carlo sampling), implemented identically in JS and a
modified patterns.py, so parity is exact and no RNG is needed. Same method
(empirical-Bayes Beta-Binomial, prior strength 8, 94% credible mass, shrink to
overall rate) and same drops-on-low threshold (whole green-red interval > 0).

## Requirements (EARS)

### R1: Pure patterns-core module
1. THE patterns-core SHALL be js/patterns-core.js, a pure module (no DOM, no
   network) with the dual-export pattern (global + module.exports for vitest).
2. THE patterns-core SHALL compute, from a list of check-in records
   {type, tier in {green,yellow,red}, done:boolean}, the same structure
   patterns.py produces: overall_rate, per-type per-tier Beta-Binomial cells
   (n, done, raw_rate, estimate, ci_low, ci_high at 94% mass, prior strength 8,
   shrunk to overall_rate), green_minus_red {diff_mean, diff_ci_low,
   diff_ci_high, drops}, and drops_on_low per type.

### R2: Deterministic Beta math (parity)
1. THE patterns-core SHALL compute each cell's posterior-mean estimate and the
   94% credible interval (ci_low, ci_high) from the Beta posterior
   Beta(m*k0+done, (1-m)*k0+(n-done)) deterministically.
2. THE patterns-core SHALL compute the green-minus-red difference interval
   deterministically (no random sampling) from the two Beta posteriors, and set
   drops = (difference ci_low > 0).
3. THE scripts/patterns.py SHALL be updated to use the SAME deterministic
   computation (replacing scipy.ppf sampling and numpy rng.beta) so JS and
   Python agree field-for-field within defined precision (4 dp).
4. WHERE any sampling were introduced, it SHALL use the shared mulberry32 PRNG;
   the chosen deterministic method needs none.

### R3: Real-data learned demotions from own logs
1. WHEN the active dataset is real/local, THE app SHALL derive learnedDemotions
   ONLY from patterns-core run on the user's own logged history (the
   localStorage check-in records), never from the committed simulated patterns.
2. THE app SHALL include a task type in learnedDemotions only when that type's
   green_minus_red interval excludes zero (drops_on_low true) in the user's own
   result.
3. WHILE the user has fewer than the minimum logged days, THE app SHALL keep the
   current "demo of the method on simulated data" message with the day count and
   SHALL NOT demote any type.
4. WHEN the user has enough logged days, THE patterns card SHALL show the user's
   OWN Beta-Binomial table computed in the browser.

### R4: Sample mode unchanged
1. WHERE the active dataset is the sample, THE app SHALL keep using the committed
   simulated window.HUIFAN_PATTERNS (table, recovery test, demotable_types) so
   the demo shows the full loop.

### R5: Parity + safety tests
1. THE test suite SHALL assert patterns-core matches patterns.py on the
   simulated logs field-for-field within 4 dp (estimates, CIs, diff interval,
   drops_on_low, demotable_types).
2. THE test suite SHALL assert that with real data and too few logged days, no
   type is demoted (reinforcing the existing guarantee).

## Correctness properties
1. Parity (model-based): patterns-core == patterns.py on simulated logs (4 dp).
2. Determinism: same logs -> same output every run (no RNG).
3. Shrinkage: a thin cell's estimate lies between its raw rate and overall_rate.
4. Interval validity: 0 <= ci_low <= estimate <= ci_high <= 1 per cell.
5. Drops monotonic in separation: if green posterior shifts strictly above red,
   drops stays true; overlapping intervals -> drops false.
6. Below min-days -> demotable list empty for real data.
