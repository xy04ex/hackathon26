# Requirements Document

## Introduction

This feature moves 烩饭 (Huifan)'s insights from precomputed, committed, builder-specific aggregates to **per-user insights computed in the browser** on whichever dataset is active. Today `data/insights.json` holds aggregates that `scripts/insights.py` computed offline from the builder's own history, so every new user — and every judge opening the demo — sees the builder's numbers rather than their own. This feature introduces a new pure module `js/insights-core.js` that computes all insights in the browser, with no DOM access and no network, from the active dataset selected by the existing data-source logic (uploaded real data, the builder's local `data/daily.js`, or the bundled synthetic sample). The existing `js/insights.js` becomes a thin renderer that calls `Insights_Core` instead of reading a committed personal `insights.json`.

The feature also upgrades the analysis itself: the sleep → next-morning HRV regression runs on **baseline-adjusted HRV** (each day's HRV minus its own trailing 30-day rolling mean) rather than raw HRV, and a **sleep-debt model comparison** uses time-ordered cross-validation to say, in one calm sentence, whether last night's sleep or the last three nights' total sleep predicts the user's next-morning HRV better. All randomness (the bootstrap confidence interval and the cross-validation folds) is made deterministic through a **shared seedable PRNG** implemented identically in Python and JavaScript, so the browser and `scripts/insights.py` produce the same resamples and the same folds. The reference analysis `scripts/insights.py` is updated to the same algorithm so that a parity test ("JS matches Python on the sample") is well defined.

Privacy stays a core feature: real insights exist only in the browser and are never committed. Any committed `insights.json` / `insights.js` is regenerated from the synthetic sample dataset and contains summaries only. All user-facing copy remains calm, short, non-judgemental, and non-medical, and the reference section deliberately avoids comparing the user's HRV to any population norm.

## Glossary

- **Insights_Core**: The new pure module `js/insights-core.js` that computes all insights from a dataset. It follows the same dual-export pattern as `js/score.js` and `js/parse-core.js` (an IIFE that attaches to `window` for `importScripts`/browser use and also sets `module.exports` for `createRequire` use in vitest). It performs no DOM access and makes no network request.
- **Active_Dataset**: The list of Daily_Record objects that the existing data-source selection (`js/app.js` `pickDataSource`) resolves to for the current session — uploaded real data (`window.HUIFAN_DAILY`), the builder's local `data/daily.js`, or the bundled sample (`window.HUIFAN_SAMPLE_DAILY`) — preferring real data, else sample.
- **Daily_Record**: An object of the shape `{ date: string, hrv: number|null, rhr: number|null, resp: number|null, sleep_h: number|null }` where `date` is `"YYYY-MM-DD"`.
- **Rolling_Mean_HRV**: For a given day, the arithmetic mean of the available (non-`null`) `hrv` values over the prior 30 calendar days, excluding the day itself.
- **Baseline_Adjusted_HRV**: For a given day with a present `hrv` value and at least the minimum required prior-history HRV values, the value `hrv − Rolling_Mean_HRV` for that day. A day without enough prior-history HRV values to form a Rolling_Mean_HRV has no Baseline_Adjusted_HRV and is excluded from pairing.
- **Paired_Day**: A pair joining night N's `sleep_h` to morning N+1's Baseline_Adjusted_HRV, kept only when day N and day N+1 are consecutive calendar days, day N has a present `sleep_h`, and day N+1 has a defined Baseline_Adjusted_HRV. The pair is labeled by the morning (HRV) date, day N+1.
- **Sleep_Debt_3n**: For a Paired_Day, the sum of `sleep_h` over the three nights immediately preceding the morning date (nights N, N−1, N−2), defined only when all three of those nights have a present `sleep_h`.
- **Time_Ordered_CV**: Forward-chaining (expanding-window) k-fold cross-validation over Paired_Days sorted ascending by date: the pairs are split into K contiguous folds by date, and for each fold the model trains only on the earlier data and tests on the later fold, so a test pair is never earlier than any training pair used to predict it.
- **Shared_PRNG**: A seedable pseudo-random number generator algorithm implemented identically in Python and JavaScript, used in place of numpy's RNG, so that for a fixed seed the browser and `scripts/insights.py` produce identical resample index sequences and identical fold assignments.
- **Reference_Context**: The built-in, honest reference figures shown to the user: the user's own short-sleep share against the 7+ hour recommendation and the CDC Suffolk County short-sleep figure; the general adult resting-HR range 60–100 bpm shown as context only; and an explicit statement that HRV is not compared to any population norm.
- **Reference_Analysis**: The updated `scripts/insights.py`, which computes the same algorithm as Insights_Core and whose output on the sample dataset defines the correct result for the parity test.
- **CDC_File**: The committed `data/cdc-short-sleep-ma.json` providing CDC PLACES short-sleep figures for Massachusetts counties.
- **Sample_Insights_Output**: The committed `data/insights.json` (and `data/insights.js`) when regenerated from the synthetic sample dataset — summaries only, no real personal values.
- **Enough_Threshold**: The minimum number of Paired_Days required before Insights_Core reports a slope estimate (at least 10 pairs, matching the Reference_Analysis).
- **Min_Baseline_History**: The minimum number of prior-history HRV values a day must have before a Rolling_Mean_HRV (and therefore a Baseline_Adjusted_HRV) can be formed for that day (at least 7 prior `hrv` values, defined in the design).

## Requirements

### Requirement 1: Insights computed in the browser on the active dataset

**User Story:** As a user, I want my insights computed from my own loaded data in the browser, so that I see my results instead of the builder's.

#### Acceptance Criteria

1. THE Insights_Core SHALL compute all insights from a dataset passed to it as a list of Daily_Record objects and SHALL NOT access the DOM.
2. THE Insights_Core SHALL make no network request when computing insights.
3. THE Insights_Core SHALL expose its functions through both a browser global (for `importScripts`/`window` use) and `module.exports` (for `createRequire` use in vitest), matching the dual-export pattern of `js/score.js` and `js/parse-core.js`.
4. WHEN the insights section is rendered, THE insights renderer (`js/insights.js`) SHALL obtain the Active_Dataset through the existing data-source selection and SHALL compute insights by calling Insights_Core on that Active_Dataset.
5. THE insights renderer SHALL NOT read a committed personal `insights.json` or `window.HUIFAN_INSIGHTS` to obtain the user's insight values.
6. WHERE the Active_Dataset is the bundled sample dataset, THE insights renderer SHALL compute and display insights from the sample dataset using Insights_Core.

### Requirement 2: Sleep to next-morning HRV slope on baseline-adjusted HRV

**User Story:** As a user, I want the sleep–HRV relationship measured against my own moving baseline, so that a slow drift in my HRV does not distort the result.

#### Acceptance Criteria

1. THE Insights_Core SHALL compute Rolling_Mean_HRV for a day as the mean of available (non-null) `hrv` values over the prior 30 calendar days, excluding the day itself.
2. THE Insights_Core SHALL compute Baseline_Adjusted_HRV for a day as that day's `hrv` minus that day's Rolling_Mean_HRV.
3. IF a day has fewer than the minimum required prior-history HRV values (Min_Baseline_History, at least 7, defined in the design) to form a Rolling_Mean_HRV, THEN THE Insights_Core SHALL treat that day as having no Baseline_Adjusted_HRV and SHALL exclude it from Paired_Days.
4. THE Insights_Core SHALL build Paired_Days joining night N's `sleep_h` to morning N+1's Baseline_Adjusted_HRV, keeping a pair only when day N and day N+1 are consecutive calendar days, day N has a present `sleep_h`, and day N+1 has a defined Baseline_Adjusted_HRV, and SHALL label each pair by the morning (day N+1) date.
5. THE Insights_Core SHALL compute the Pearson correlation between previous-night `sleep_h` and next-morning Baseline_Adjusted_HRV over the Paired_Days.
6. THE Insights_Core SHALL compute the ordinary-least-squares slope in milliseconds per hour and the intercept for next-morning Baseline_Adjusted_HRV regressed on previous-night `sleep_h`.
7. THE Insights_Core SHALL compute a bootstrap 95% confidence interval for the slope using 5000 resamples of the Paired_Days drawn with the Shared_PRNG, taking the 2.5th and 97.5th percentiles of the resampled slopes as the bounds.
8. THE Insights_Core SHALL report that the confidence interval excludes zero WHEN the lower bound is greater than zero OR the upper bound is less than zero.
9. IF there are fewer than the Enough_Threshold (at least 10) Paired_Days, THEN THE Insights_Core SHALL report the slope section as not having enough data rather than producing a slope estimate.
10. WHERE the 95% confidence interval excludes zero, THE insights renderer SHALL state in plain language that the effect looks real.
11. WHERE the 95% confidence interval includes zero, THE insights renderer SHALL state in plain language that the effect is suggestive only.
12. WHEN a sustained step change in HRV level is detected under the existing device-change rules, THE Insights_Core SHALL restrict the primary slope analysis to the most recent consistent segment, consistent with the Reference_Analysis.

### Requirement 3: Sleep-debt model comparison with time-ordered cross-validation

**User Story:** As a user, I want to know whether last night's sleep or my recent sleep debt better predicts my next-morning HRV, so that I understand what matters for me.

#### Acceptance Criteria

1. THE Insights_Core SHALL define a last-night model as a single-feature ordinary-least-squares regression predicting next-morning Baseline_Adjusted_HRV from the previous night's `sleep_h`.
2. THE Insights_Core SHALL define a sleep-debt model as a single-feature ordinary-least-squares regression predicting next-morning Baseline_Adjusted_HRV from Sleep_Debt_3n, including a Paired_Day only when all three prior nights have a present (non-null) `sleep_h`.
3. THE Insights_Core SHALL evaluate both models with Time_Ordered_CV using 5 forward-chaining folds, sorting Paired_Days ascending by date, splitting them into 5 contiguous equal-sized folds (earliest pairs first, any remainder assigned to later folds), and for each fold after the first, training on all pairs in earlier folds and testing on the current fold.
4. THE Insights_Core SHALL never train a fold's model on any Paired_Day whose date is equal to or later than the earliest date in that fold's test pairs.
5. THE Insights_Core SHALL report each model's out-of-sample root-mean-square error (RMSE) as the unweighted mean of the per-fold RMSE values across all tested folds as the primary error measure.
6. THE Insights_Core SHALL compute both models' RMSE values deterministically from date-ordered folds using no random number generation, such that repeated runs on identical input Paired_Days produce identical RMSE values to within 1e-9.
7. WHEN both models' averaged RMSE values are available, THE insights renderer SHALL produce exactly one plain-language sentence stating which model predicts the user's next-morning HRV better, OR stating that the difference is negligible.
8. WHERE the absolute difference between the two models' averaged RMSE is at or below the negligible threshold defined in the design, THE insights renderer SHALL state that the difference is negligible rather than naming a winner.
9. IF the number of Paired_Days available for a model is fewer than 5 (insufficient to form 5 non-empty folds), THEN THE Insights_Core SHALL report that there are too few pairs for cross-validation, SHALL NOT produce a winner-or-negligible verdict, and SHALL NOT force the comparison.

### Requirement 4: Honest built-in reference, not population HRV norms

**User Story:** As a user, I want honest context for my numbers without being judged or diagnosed, so that I can interpret my data responsibly.

#### Acceptance Criteria

1. THE Insights_Core SHALL compute the share of the user's tracked nights with `sleep_h` under 7 hours over the nights that have a present `sleep_h`.
2. THE insights renderer SHALL display the user's short-sleep share next to the recommendation that adults get 7 or more hours of sleep.
3. THE insights renderer SHALL display the CDC Suffolk County short-sleep figure read from the CDC_File.
4. THE insights renderer SHALL display the user's resting HR alongside the general adult range of 60 to 100 bpm, presented as context only and not as a judgement or a diagnosis.
5. THE insights renderer SHALL NOT compare the user's HRV to any population norm or clinical reference value.
6. THE insights renderer SHALL state that between-person HRV variation is large and that wearable HRV is not comparable to clinical norms, as the reason only the user's own baseline is used.
7. THE insights renderer SHALL keep all Reference_Context copy non-judgemental and non-medical.

### Requirement 5: Deterministic, reproducible randomness

**User Story:** As a user and as a developer, I want the same data to always produce the same insights, so that results are trustworthy and reproducible across the browser and the scripts.

#### Acceptance Criteria

1. THE Insights_Core SHALL use the Shared_PRNG, seeded with the fixed seed pinned in the design, to generate bootstrap resample index sequences, and SHALL assign cross-validation folds deterministically by date order without using the Shared_PRNG.
2. THE Reference_Analysis SHALL use the Shared_PRNG, seeded with the same fixed seed pinned in the design, in place of numpy's RNG to generate bootstrap resample index sequences, and SHALL assign cross-validation folds deterministically by date order.
3. THE Shared_PRNG SHALL implement the single integer PRNG algorithm pinned in the design (a 32-bit algorithm such as mulberry32), with identical state initialization, state transition, and output mapping in both the Insights_Core and the Reference_Analysis implementations.
4. WHEN the Insights_Core is run two or more times on the same dataset with the same fixed seed, THE Insights_Core SHALL produce identical insight values and identical confidence-interval bounds on every run.
5. WHEN the Insights_Core and the Reference_Analysis are each run on the same dataset with the same fixed seed, THE Shared_PRNG SHALL emit the same ordered sequence of resample indices and the same fold assignments in both, and the two runs SHALL yield identical confidence-interval bounds.

### Requirement 6: Stop committing personal aggregates

**User Story:** As the builder, I want the repository to hold no real personal insight values, so that uploading the project does not leak my health data.

#### Acceptance Criteria

1. THE project SHALL commit `data/insights.json` and `data/insights.js` only as Sample_Insights_Output regenerated from the synthetic sample dataset, OR SHALL remove them from the committed set in favor of in-browser computation.
2. THE Sample_Insights_Output SHALL contain summary values only and SHALL contain no real personal daily values.
3. WHERE `scripts/insights.py` is run on real data, THE resulting `data/insights.json` and `data/insights.js` SHALL be git-ignored so that real insights are never committed.
4. THE user's real insights SHALL exist only in the browser and SHALL NOT be written to any committed file.

### Requirement 7: Parity with the reference analysis

**User Story:** As a developer, I want the browser insights to match the Python reference on the sample, so that the in-browser math is provably correct.

#### Acceptance Criteria

1. THE Reference_Analysis SHALL be updated to compute the same algorithm as Insights_Core, including Baseline_Adjusted_HRV, the sleep-debt cross-validation comparison, and the Shared_PRNG.
2. WHEN Insights_Core and the Reference_Analysis are run on the same sample dataset with the same seed, THE Insights_Core SHALL produce the pair count, Pearson r, slope, intercept, confidence-interval bounds, cross-validation errors, model-comparison verdict, and reference/CDC figures equal to the Reference_Analysis field-for-field within the precision defined in the design.
3. THE test suite SHALL include a test asserting the parity described in acceptance criterion 2 on the sample dataset.

### Requirement 8: Graceful degradation

**User Story:** As a new user with little data, I want the insights page to stay calm and honest when there is not enough data, so that I am never shown misleading numbers or an error.

#### Acceptance Criteria

1. IF the Active_Dataset has fewer than the Enough_Threshold of Paired_Days, THEN THE insights renderer SHALL display a calm "not enough data yet" state for the slope section instead of a slope estimate.
2. IF there are too few Paired_Days to form the cross-validation folds, THEN THE insights renderer SHALL display a calm "not enough data yet" state for the model-comparison section.
3. IF the Active_Dataset contains no present `hrv` values, THEN THE insights renderer SHALL display a calm "not enough data yet" state rather than erroring.
4. THE Insights_Core SHALL treat a `null` metric value as missing and SHALL NOT treat a `null` value as `0`.
5. WHILE the Active_Dataset is insufficient for a section, THE insights renderer SHALL render the remaining sections that do have sufficient data rather than failing the whole page.

## Correctness Properties (for property-based testing)

These properties target the math-critical logic of Insights_Core and should be tested with fast-check against pure functions, independent of the DOM and the network. The parity property is model-based against the Reference_Analysis on the sample dataset.

1. **Parity with the reference (Model-Based)**: For the sample dataset and a fixed seed, every reported field from Insights_Core (pairs, r, slope, intercept, CI bounds, CV errors, model-comparison verdict, and reference/CDC figures) equals the Reference_Analysis (`scripts/insights.py`) output within the defined precision.
2. **Determinism (Idempotence/Invariant)**: For any dataset and a fixed seed, running Insights_Core twice yields identical insight values.
3. **Baseline-adjustment correctness (Invariant)**: For any day with a Baseline_Adjusted_HRV, its Rolling_Mean_HRV uses only `hrv` values from the prior 30 calendar days and never includes the day itself; changing the day's own `hrv` does not change its Rolling_Mean_HRV.
4. **Few-history exclusion (Invariant)**: For any day with fewer than the minimum required prior-history HRV values, that day has no Baseline_Adjusted_HRV and appears in no Paired_Day.
5. **Pairing correctness (Invariant)**: For any dataset, every Paired_Day joins consecutive calendar days with a present night-N `sleep_h` and a defined morning-(N+1) Baseline_Adjusted_HRV, and is labeled by the morning date; no non-consecutive or incomplete pair appears.
6. **Time-ordered CV never trains on the future (Invariant)**: For any dataset and fold count, within each fold no training pair has a date later than any test pair in that fold (no test index precedes any train index under the forward-chaining split).
7. **Sleep-debt completeness (Invariant)**: For any Paired_Day included in the sleep-debt model, all three preceding nights have a present `sleep_h`; a pair missing any of the three is excluded from the sleep-debt model.
8. **Bootstrap CI determinism under the shared PRNG (Invariant)**: For a fixed seed, the bootstrap resample index sequence — and therefore the CI bounds — are identical between Insights_Core and the Reference_Analysis.
9. **Null-not-zero (Invariant)**: For any dataset, a `null` metric value is treated as missing everywhere (rolling mean, pairing, short-sleep share) and is never treated as `0`.
10. **Reference never compares HRV to population norms (Invariant)**: For any dataset, the Reference_Context output contains no comparison of the user's HRV to a population or clinical norm.
11. **Short-sleep share bounds (Metamorphic)**: For any dataset, the user's short-sleep share is between 0 and 1 inclusive and is computed only over nights with a present `sleep_h`; adding a night of 7 or more hours never increases the share.

## Future / Out of Scope

The following are captured for context but are not built in this feature:

- Multivariate models combining sleep with resting HR, respiratory rate, or other features to predict HRV.
- Any causal claim; the insights remain lagged within-person associations and a personal planning aid, not causation and not medical advice.
- Additional sleep-debt windows beyond the three-night model (for example 7-night rolling debt).
- Automatic re-computation or notifications when new data arrives.
