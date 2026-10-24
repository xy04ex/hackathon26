# Tasks — browser-patterns

## Parity note
Deterministic Beta math shared by JS and patterns.py: discretize each Beta
posterior on a shared fixed grid (e.g. 0..1 in 1000 steps via a regularized
incomplete beta CDF), read 3%/97% quantiles for cell CIs, and convolve
green/red grids to get the (green-red) difference CDF for diff_ci_low/high and
drops. Implement the SAME grid + incomplete-beta in both languages. Round to
4 dp. No RNG.

- [ ] 1. Deterministic Beta helpers in js/patterns-core.js
  - [ ] 1.1 Regularized incomplete beta (betacdf) + log-gamma; posterior mean;
        grid quantiles for a cell CI (94% mass). Pure, dual-export.
    - _R1.1, R2.1_
  - [ ]* 1.2 Property test: interval validity (0<=lo<=est<=hi<=1), shrinkage.
    - _props 3,4_

- [ ] 2. Cell + difference analysis
  - [ ] 2.1 beta_binomial_cell (n, done, estimate, ci_low, ci_high, _alpha,
        _beta); difference interval green-red via grid convolution; drops =
        diffLo > 0. analyze() builds overall_rate + per-type structure +
        drops_on_low + demotable_types, matching patterns.py keys/rounding.
    - _R1.2, R2.1, R2.2_
  - [ ]* 2.2 Property test: determinism; drops monotonic in separation.
    - _props 2,5_

- [ ] 3. Update patterns.py to the deterministic method
  - [ ] 3.1 Replace scipy.ppf + numpy rng.beta with the SAME incomplete-beta
        grid method (stdlib only via math.lgamma; drop numpy/scipy for this).
        Keep recovery_test, output keys, and 4 dp rounding identical.
    - _R2.3_

- [ ] 4. Parity test
  - [ ] 4.1 Run patterns.py on data/simulated-logs.json -> expected; assert
        patterns-core matches field-for-field within 4 dp. Commit expected as
        a fixture.
    - _R5.1, prop 1_

- [ ] 5. Wire real-data demotions from own logs
  - [ ] 5.1 In app.js: convert localStorage check-in history to records
        {type, tier, done}; run patterns-core; learnedDemotions = types with
        drops_on_low. Only for real/local; only at/above MIN_DAYS; else [].
        Sample mode keeps window.HUIFAN_PATTERNS.
    - _R3.1, R3.2, R3.3, R4.1_
  - [ ] 5.2 Patterns card: when real + enough days, render the user's OWN table
        from patterns-core; else keep the demo message + day count.
    - _R3.3, R3.4_
  - [ ]* 5.3 Test: real data, too few days -> no demotions.
    - _R5.2, prop 6_

- [ ] 6. Final: full suite green; sample demo unchanged.

## Notes
- `*` tasks are tests (run them). Hard stop 5:15: if not done, revert to the
  pushed working state and report.
- Tier for a logged record = the recovery band stored on the check-in record
  (buildRecord stores tier). Records with no tier/done are skipped.
