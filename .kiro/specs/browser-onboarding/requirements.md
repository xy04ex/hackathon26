# Requirements Document

## Introduction

This feature adds in-browser onboarding to 烩饭 (Huifan) so a new user can turn their Apple Health export into a personal recovery baseline without running any Python and without their health data ever leaving the browser. Today the only path to data is `scripts/parse_health.py`, which a normal user cannot run. The onboarding flow explains how to export Health data on an iPhone, lets the user pick their `export.zip`, parses it locally in a Web Worker (streaming both the unzip and the XML so the whole file is never held in memory), and stores the resulting daily records in the browser so the existing app (`js/app.js`, via `window.HUIFAN_DAILY`) can read them.

The parsed output must be **byte-for-byte equivalent in records** to what `scripts/parse_health.py` produces for the same export, so the recovery score, patterns, and insights behave identically regardless of which path produced the data. Privacy is a core feature: no backend, no accounts, and no network call carries health data anywhere. The tone of all user-facing copy stays calm, short, friendly, and non-judgemental.

## Glossary

- **Onboarding_UI**: The browser-side user interface that presents export instructions, the file picker, the parsing-range option, the progress and cancel controls, and the delete-data control.
- **Parse_Worker**: The Web Worker that unzips and parses the Apple Health export using streaming for both the unzip and the XML, producing daily records.
- **Daily_Record**: An object of the shape `{ date: string, hrv: number|null, rhr: number|null, resp: number|null, sleep_h: number|null }` where `date` is `"YYYY-MM-DD"`.
- **Daily_Dataset**: The list of Daily_Record objects, sorted ascending by `date`.
- **Health_Export**: The `export.zip` file produced by the iPhone Health app, containing `apple_health_export/export.xml`.
- **Export_XML**: The `export.xml` file inside the Health_Export, containing Apple Health `Record` elements.
- **Browser_Store**: The in-browser persistence (localStorage, wrapped in try/catch) where the Daily_Dataset is saved so the app can read it across page loads.
- **Reference_Parser**: The existing `scripts/parse_health.py` script, whose record output defines the correct result.
- **Range_Option**: The user's choice of how far back to parse — last 6 months (default) or everything.
- **Asleep_Stage**: An Apple Health `SleepAnalysis` value in the set {`HKCategoryValueSleepAnalysisAsleep`, `HKCategoryValueSleepAnalysisAsleepCore`, `HKCategoryValueSleepAnalysisAsleepDeep`, `HKCategoryValueSleepAnalysisAsleepREM`, `HKCategoryValueSleepAnalysisAsleepUnspecified`}. Values `InBed` and `Awake` are excluded.
- **Wake_Date**: The calendar date of a sleep interval's end time, used to assign the interval to a night.
- **Daily_Mean**: The arithmetic mean of a day's values for a quantity metric, rounded to 2 decimal places, or `null` when the day has no values.
- **Sample_Dataset**: The bundled synthetic dataset exposed as `window.HUIFAN_SAMPLE_DAILY` (from `data/sample-daily.js`), used for the "Try with sample data" path. It is never saved to the Browser_Store and never assigned to `window.HUIFAN_DAILY`.

## Requirements

### Requirement 1: First-run export instructions and file picker

**User Story:** As a new user, I want clear instructions for exporting my Apple Health data and a way to pick the file, so that I can get my data into 烩饭 without technical help.

#### Acceptance Criteria

1. WHEN a user opens 烩饭 with no Daily_Dataset present in the Browser_Store and no `window.HUIFAN_DAILY` loaded, THE Onboarding_UI SHALL display a first-run screen.
2. THE Onboarding_UI SHALL present the export steps as three short steps: open the Health app, open the profile, and choose "Export All Health Data" to produce `export.zip`.
3. THE Onboarding_UI SHALL display a file picker that accepts a single `export.zip` file.
4. THE Onboarding_UI SHALL display a privacy statement that the selected file is parsed in the browser and is not sent anywhere.

### Requirement 2: Local streaming parse in a Web Worker

**User Story:** As a privacy-conscious user, I want my export parsed locally without loading the whole file into memory, so that a large export works and my data never leaves my device.

#### Acceptance Criteria

1. WHEN a user selects a Health_Export file, THE Onboarding_UI SHALL hand the file to the Parse_Worker for parsing in a Web Worker without first reading the entire file contents into the Onboarding_UI thread.
2. THE Parse_Worker SHALL stream the unzip of the Health_Export in sequential chunks rather than reading the entire archive into memory at once.
3. THE Parse_Worker SHALL stream the parse of the Export_XML incrementally, discarding each parsed XML element after extracting its Daily_Record fields, rather than reading the entire XML into memory at once.
4. WHEN a user selects a Health_Export of approximately 49 megabytes, THE Parse_Worker SHALL complete parsing and produce a Daily_Dataset.
5. THE Onboarding_UI SHALL make no network request that transmits the contents of the Health_Export or any Daily_Record.
6. IF the Parse_Worker encounters a Health_Export that is not a readable ZIP archive or that contains no Export_XML, THEN THE Parse_Worker SHALL stop parsing, retain no Daily_Dataset, and return an error indication that the export could not be parsed.

### Requirement 3: Range selection

**User Story:** As a user, I want to parse only recent data by default, so that onboarding is faster and still gives me a useful baseline.

#### Acceptance Criteria

1. THE Onboarding_UI SHALL present a Range_Option offering "last 6 months" and "everything".
2. WHERE the user has not changed the Range_Option, THE Onboarding_UI SHALL use "last 6 months" as the default.
3. WHERE the Range_Option is "last 6 months", THE Parse_Worker SHALL include a record only IF the record has a valid assigned date AND that assigned date is within the last 6 months relative to the most recent record date in the Health_Export.
4. WHERE the Range_Option is "everything", THE Parse_Worker SHALL include records of every date in the Health_Export.

### Requirement 4: Progress, cancel, and invalid-file handling

**User Story:** As a user, I want to see progress, be able to cancel, and get a friendly message if my file is wrong, so that I am never stuck or confused.

#### Acceptance Criteria

1. WHILE the Parse_Worker is parsing, THE Onboarding_UI SHALL display a progress indicator that updates as parsing proceeds.
2. WHILE the Parse_Worker is parsing, THE Onboarding_UI SHALL display a cancel control.
3. WHEN a user activates the cancel control, THE Onboarding_UI SHALL terminate the Parse_Worker, discard any partially parsed data without saving a Daily_Dataset, and return to the file-picker state.
4. IF the selected file cannot be opened as a ZIP archive, THEN THE Onboarding_UI SHALL display a friendly message that the file does not look like an Apple Health export and SHALL return to the file-picker state.
5. IF the selected file is a readable ZIP archive but contains no member whose path ends with export.xml, THEN THE Onboarding_UI SHALL display a friendly message that the file does not look like an Apple Health export and SHALL return to the file-picker state.
6. IF the Parse_Worker encounters an error that prevents completion, THEN THE Onboarding_UI SHALL display a friendly error message, discard any partially parsed data without saving a Daily_Dataset, and return to the file-picker state.

### Requirement 5: Record parity with the reference parser

**User Story:** As a user, I want the browser parse to produce exactly the same daily records as the developer script, so that my recovery score is correct and consistent.

#### Acceptance Criteria

1. THE Parse_Worker SHALL produce a Daily_Dataset sorted in ascending order by `date`, where each entry is a record containing the fields `date`, `hrv`, `rhr`, `resp`, and `sleep_h`.
2. THE Parse_Worker SHALL set `hrv` for a day to the Daily_Mean of `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` values whose start date falls on that day, rounded to 2 decimal places.
3. THE Parse_Worker SHALL set `rhr` for a day to the Daily_Mean of `HKQuantityTypeIdentifierRestingHeartRate` values whose start date falls on that day, rounded to 2 decimal places.
4. THE Parse_Worker SHALL set `resp` for a day to the Daily_Mean of `HKQuantityTypeIdentifierRespiratoryRate` values whose start date falls on that day, rounded to 2 decimal places.
5. THE Parse_Worker SHALL include only sleep records whose stage is one of `Asleep`, `AsleepCore`, `AsleepDeep`, `AsleepREM`, or `AsleepUnspecified` and SHALL exclude `InBed` and `Awake` records when computing `sleep_h`.
6. THE Parse_Worker SHALL merge overlapping asleep intervals from all sources for a Wake_Date so that any time covered by two or more intervals is counted exactly once.
7. THE Parse_Worker SHALL assign each asleep interval to the Wake_Date, which is the calendar date of the interval's end time.
8. THE Parse_Worker SHALL set `sleep_h` for a day to the merged asleep duration in hours rounded to 2 decimal places.
9. IF the merged asleep duration for a day is zero, THEN THE Parse_Worker SHALL set `sleep_h` to `null`.
10. WHERE a day has no values for a metric, THE Parse_Worker SHALL set that metric to `null` and SHALL NOT set it to `0`.
11. WHEN parsing a fixture Health_Export for which the Reference_Parser (`scripts/parse_health.py`) produces a known record list, THE Parse_Worker SHALL produce a Daily_Dataset that equals that reference record list, comparing field-for-field including `null` values and numeric values at 2-decimal-place precision.

### Requirement 6: Save result in the browser and allow deletion

**User Story:** As a user, I want my parsed data kept in my browser and a way to delete it, so that the app works across visits and I stay in control of my data.

#### Acceptance Criteria

1. WHEN the Parse_Worker completes successfully, THE Onboarding_UI SHALL save the Daily_Dataset to the Browser_Store.
2. WHEN the Daily_Dataset is saved, THE Onboarding_UI SHALL make the Daily_Dataset available as `window.HUIFAN_DAILY` so that `js/app.js` reads it through the existing data-source selection.
3. THE Onboarding_UI SHALL display a "Delete my data" control.
4. WHEN a user activates the "Delete my data" control, THE Onboarding_UI SHALL remove the Daily_Dataset from the Browser_Store, SHALL clear the in-memory `window.HUIFAN_DAILY` value immediately, and SHALL return the app to the first-run screen.
5. IF the Browser_Store is unavailable, THEN THE Onboarding_UI SHALL still make the Daily_Dataset available as `window.HUIFAN_DAILY` for the current session.

### Requirement 7: Desktop and phone expectations

**User Story:** As a user on a phone, I want to know that uploading from a computer is easier, so that I have the smoothest path without being blocked.

#### Acceptance Criteria

1. THE Onboarding_UI SHALL support the onboarding flow on desktop browsers.
2. WHILE the Onboarding_UI is displayed on a phone-width viewport, THE Onboarding_UI SHALL display a note that uploading the export from a computer is easier.
3. WHILE the Onboarding_UI is displayed on a phone-width viewport, THE Onboarding_UI SHALL still allow the user to select and parse a Health_Export.

### Requirement 8: Small datasets do not block onboarding

**User Story:** As a new user with little history, I want onboarding to finish even if I have few days of data, so that I can still use the app while it learns my baseline.

#### Acceptance Criteria

1. WHEN the Parse_Worker produces a Daily_Dataset with fewer than 7 days, THE Onboarding_UI SHALL save the Daily_Dataset and complete onboarding.
2. WHEN a Daily_Dataset with fewer than 7 days is loaded, THE app SHALL keep its existing "still learning your baseline" state and SHALL NOT block onboarding.

### Requirement 9: Try with sample data

**User Story:** As someone opening the demo link without an Apple Health export, I want to try 烩饭 with bundled sample data, so that I can see how it works without uploading anything.

#### Acceptance Criteria

1. THE Onboarding_UI SHALL display a "Try with sample data" control on the first-run screen.
2. WHEN a user activates the "Try with sample data" control, THE Onboarding_UI SHALL load the Sample_Dataset (`window.HUIFAN_SAMPLE_DAILY`) and render the app from the Sample_Dataset.
3. WHEN the user tries with sample data, THE Onboarding_UI SHALL NOT save the Sample_Dataset to the Browser_Store and SHALL NOT set `window.HUIFAN_DAILY`.
4. WHEN the app renders from the Sample_Dataset, THE Onboarding_UI SHALL display an indication that it is showing sample (synthetic) data, consistent with the existing sample data badge.
5. WHILE the app is showing the Sample_Dataset, THE Onboarding_UI SHALL allow the user to return to the first-run screen to upload a real Health_Export.

## Correctness Properties (for property-based testing)

These properties target the parity-critical logic and should be tested with fast-check against pure functions, independent of the DOM and the Web Worker.

1. **Parse/reference round-trip parity (Model-Based)**: For a fixture Health_Export, the Daily_Dataset from the Parse_Worker equals the Reference_Parser (`scripts/parse_health.py`) record list exactly — same days, same values, same `null`s, same order.
2. **Sort order (Invariant)**: For any set of records, the output Daily_Dataset is sorted strictly ascending by `date` with no duplicate dates.
3. **Sleep interval merging (Metamorphic)**: For any set of sleep intervals on a night, the merged duration is less than or equal to the sum of individual durations, equal only when no intervals overlap; adding a fully-contained interval does not change the merged duration.
4. **Merge order independence (Confluence)**: For any set of sleep intervals, the merged duration is identical regardless of the order in which the intervals are supplied.
5. **Wake-date assignment (Invariant)**: For any sleep interval, the record it contributes to has `date` equal to the calendar date of the interval's end time.
6. **Asleep-stage filtering (Invariant)**: For any mix of sleep records, records with value `InBed` or `Awake` contribute zero duration to `sleep_h`.
7. **Null-not-zero (Invariant)**: For any day with no values for a metric, that metric is `null`, and no present metric value is ever silently replaced by `0`.
8. **Rounding (Invariant)**: For any day with values, each Daily_Mean and `sleep_h` has at most 2 decimal places and equals the full-precision value rounded to 2 decimals.
9. **Last-N-months filter (Metamorphic)**: For any dataset, the "last 6 months" result is a subset of the "everything" result containing exactly the records whose assigned date is within 6 months of the most recent record date; the "everything" result is unchanged by the filter.
10. **Idempotence of save/load**: Saving a Daily_Dataset to the Browser_Store and loading it back yields an equal Daily_Dataset (serialize/deserialize round-trip).
11. **Sample data does not persist (Invariant)**: After the "Try with sample data" path runs, the Browser_Store contains no saved Daily_Dataset attributable to onboarding and `window.HUIFAN_DAILY` is not set to the sample data; the sample path is purely in-memory for the session.

## Future / Out of Scope

The following are captured for context but are not built in this feature:

- Daily automatic sync via an iOS Shortcut.
- A native app that reads HealthKit (iOS) or Android Health Connect directly.
