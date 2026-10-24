# Implementation Plan: Browser Insights

## Overview

Move the insights math into a pure, DOM-free `js/insights-core.js` that runs on
whichever dataset is active, update `scripts/insights.py` to the SAME algorithm,
and prove byte-parity on the sample. No design doc — parity notes live here.

## Parity notes (carried from requirements; these are the risk points)

- **Shared mulberry32 PRNG, identical stream in Python and JS.** Seed is a fixed
  32-bit uint (pin seed = 0x9E3779B9). Algorithm (must match exactly):
  `state = (state + 0x6D2B79F5) >>> 0; t = state; t = Math.imul(t ^ (t>>>15), t|1);
  t ^= t + Math.imul(t ^ (t>>>7), t|61); return ((t ^ (t>>>14)) >>> 0) / 4294967296`.
  Bootstrap resample index = `Math.floor(rand() * n)`. Python mirrors this with
  explicit uint32 masking (`& 0xFFFFFFFF`) and `imul` via `(a*b) & 0xFFFFFFFF`
  then wrap to signed only where JS `Math.imul` would. A dedicated cross-language
  test pins the first N outputs equal.
- **Same summation approach as parse-core/parity work.** Use Neumaier compensated
  summation for means (matches CPython `sum()` 3.12). Pearson r, OLS slope, and
  RMSE must be computed the SAME way on both sides (define the exact formulas in
  insights-core and port them verbatim to Python — do NOT use numpy reductions
  that sum differently; compute sums explicitly with the shared method).
- **Rounding:** reuse the Python-exact `round2`-style rounding already in
  parse-core for any rounded output fields, at the precision insights.py uses
  (r to 3dp, slope/CI/RMSE to 2dp). Keep raw values for internal CV comparisons.
- **CV folds are deterministic by date order (no PRNG).** Only the bootstrap uses
  the PRNG.

## Tasks

- [ ] 1. Shared PRNG (parity-critical, do first)
  - [ ] 1.1 Implement mulberry32 in JS and Python
    - Add `makeRng(seed)` to `js/insights-core.js` (mulberry32 as above) and the
      identical generator in `scripts/insights.py` (uint32 masking). Pin seed
      constant SEED = 0x9E3779B9 in both.
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ] 1.2 Cross-language PRNG parity test
    - Commit `tests/fixtures/prng-stream.json`: the first 1000 outputs of the JS
      mulberry32 at SEED. Add a vitest test asserting JS reproduces it, and a
      tiny Python check (run in the parity test harness) asserting Python matches
      the same stream. This pins the stream before any stats depend on it.
    - _Requirements: 5.3, 5.5; Property 8_

- [ ] 2. Pure stats helpers in `js/insights-core.js`
  - [ ] 2.1 Summation, mean, pearson, OLS, RMSE
    - `neumaierSum`, `mean`, `pearsonR(x,y)`, `olsSlopeIntercept(x,y)`,
      `rmse(pred,actual)` — all using the shared summation; no numpy-style paths.
    - _Requirements: 2.5, 2.6, 3.5_
  - [ ]* 2.2 Property tests for the stats helpers
    - Pearson r in [-1,1]; OLS slope sign matches a constructed positive/negative
      relationship; RMSE >= 0 and 0 iff exact. fast-check, 100 runs, createRequire.
    - _Requirements: 2.5, 2.6, 3.5_

- [ ] 3. Baseline-adjusted HRV + pairing
  - [ ] 3.1 Rolling mean, baseline adjustment, pair builder
    - `rollingMeanHrv(rows, i)` = mean of non-null hrv in prior 30 calendar days
      excluding day i; require >= 7 (MIN_BASELINE_HISTORY) prior values else the
      day has no adjusted HRV. `buildPairs(rows)` joins night N sleep -> morning
      N+1 adjusted HRV, consecutive days only, both present, labeled by morning
      date.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 8.4_
  - [ ]* 3.2 Property tests: baseline + pairing
    - Rolling mean excludes the day itself and only uses prior 30 days (Property
      3); few-history days excluded (Property 4); pairs consecutive+complete and
      labeled by morning date (Property 5); null never 0 (Property 9).
    - _Requirements: 2.1, 2.3, 2.4, 8.4_

- [ ] 4. Slope + bootstrap CI + device-change
  - [ ] 4.1 analyzeWindow + bootstrap CI (shared PRNG) + device-change port
    - Port `detect_device_change` and `analyze_window` to insights-core using the
      shared PRNG (5000 resamples, 2.5/97.5 percentiles, excludes-zero rule, >=10
      pairs). Keep recent-segment restriction.
    - _Requirements: 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

- [ ] 5. Sleep-debt CV comparison
  - [ ] 5.1 3-night debt feature + time-ordered 5-fold CV
    - `sleepDebt3n` (all three prior nights present); forward-chaining 5-fold CV
      (contiguous by date, train earlier/test later, never future); mean per-fold
      RMSE for both models; verdict with NEGLIGIBLE_RMSE threshold (0.1 ms);
      too-few (<5) -> report insufficient.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_
  - [ ]* 5.2 Property tests: CV never trains on future; debt completeness
    - Property 6 (no future in train), Property 7 (3-night completeness).
    - _Requirements: 3.4, 3.2_

- [ ] 6. Reference section (honest, no HRV norms)
  - [ ] 6.1 Short-sleep share + CDC + RHR range (in core)
    - `shortSleepShare(rows)` over nights with sleep present; expose CDC Suffolk
      figure passthrough and the 60–100 bpm RHR context; NO HRV population
      comparison anywhere in core output.
    - _Requirements: 4.1, 4.3, 4.4, 4.5_
  - [ ]* 6.2 Property test: share bounds + no HRV norm field
    - Property 11 (share in [0,1], 7h+ never raises it); Property 10 (no HRV-norm
      field present).
    - _Requirements: 4.1, 4.5_

- [ ] 7. Top-level computeInsights + dual export
  - [ ] 7.1 Assemble computeInsights(rows, {seed}) and export
    - One entry returning the full insights object (pairs, slope block, cv block,
      reference block, device-change, note). IIFE + module.exports + global,
      matching score.js/parse-core.js.
    - _Requirements: 1.1, 1.2, 1.3, 2.*, 3.*, 4.*_
  - [ ]* 7.2 Determinism property test
    - Property 2: same dataset+seed twice -> identical output.
    - _Requirements: 5.4_

- [ ] 8. Update the Python reference to the same algorithm
  - [ ] 8.1 Port insights-core algorithm into scripts/insights.py
    - Baseline-adjusted HRV, 3-night debt CV, shared mulberry32 (replace numpy
      RNG), same summation/formulas, same rounding. Keep device-change. Writes
      sample-only insights.json/.js.
    - _Requirements: 7.1, 5.2, 6.1, 6.2_

- [ ] 9. Enlarge the sample dataset (~180+ days)
  - [ ] 9.1 Grow make_sample_daily.py to ~200 days and regenerate sample
    - Enough history for 30-day baseline + meaningful CV + possible device-change;
      regenerate data/sample-daily.json and .js. Deterministic seed.
    - _Requirements: 3.3 (meaningful folds), 7.2_

- [ ] 10. Parity test (the gate)
  - [ ] 10.1 JS insights-core == insights.py on the sample
    - Run scripts/insights.py on the sample to produce expected JSON (committed
      as sample-only insights.json). vitest loads insights-core via createRequire,
      runs on the sample, asserts field-for-field within precision (r 3dp,
      slope/CI/RMSE 2dp; verdict string; counts exact). Include the PRNG stream
      check from 1.2.
    - _Requirements: 7.2, 7.3; Property 1_

- [ ] 11. Renderer + privacy cleanup
  - [ ] 11.1 Make js/insights.js compute via insights-core on the active dataset
    - Stop reading window.HUIFAN_INSIGHTS for user values; call
      computeInsights(pickDataSource rows). Render slope/CI verdict, CV sentence,
      reference block with the no-HRV-norm statement; graceful "not enough data".
    - _Requirements: 1.4, 1.5, 1.6, 2.9, 2.10, 3.6, 3.7, 4.2, 4.6, 4.7, 8.1, 8.2, 8.3, 8.5_
  - [ ] 11.2 Git-ignore real insights; keep only sample output committed
    - Add data/insights.json + data/insights.js to .gitignore IF they can hold
      real data; commit the sample-generated insights.json as the demo artifact
      (or drop the committed file entirely and compute in-browser). Ensure no
      real personal aggregates remain committed.
    - _Requirements: 6.1, 6.3, 6.4_

- [ ] 12. Final: run all tests, verify sample parity
  - Ensure full suite is green; confirm the committed insights.json is sample-only.

## Notes

- Tasks marked `*` are property tests (optional for a minimal ship, but the user
  asked to include them; run them). Non-`*` tasks are required.
- Deadline-aware order: PRNG + stats + parity are front-loaded; the renderer and
  sample enlargement come after the math is proven. A working shippable state is
  reached once tasks 1–8 + 10 are green (core computes and matches Python);
  11 wires the UI; 9 improves the demo data.
- Reuse the Python-exact rounding and Neumaier summation already proven in
  js/parse-core.js — do not reinvent.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "6.1"] },
    { "id": 3, "tasks": ["3.2", "4.1", "6.2"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2", "7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["11.1", "11.2"] },
    { "id": 10, "tasks": ["12"] }
  ]
}
```
