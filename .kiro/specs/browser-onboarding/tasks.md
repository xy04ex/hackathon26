# Implementation Plan: Browser Onboarding

## Overview

This plan builds the in-browser Apple Health onboarding flow in three layers, in
dependency order: the pure parse-core logic and its tests first, then the I/O
worker that streams the file through it, then the DOM UI and the `index.html` /
`app.js` wiring that activates the flow. The parity fixture is set up early so the
gate test (Requirement 5.11) can be written alongside the pure logic.

The stack is locked: plain HTML + CSS + vanilla JS, no build step. `js/parse-core.js`
uses the IIFE + `module.exports` dual-export pattern so it loads via `importScripts`
in the worker and via `createRequire` under vitest. The XML side is a hand-written
incremental scanner (no `DOMParser`). Unzip feature-detects native
`DecompressionStream('deflate-raw')` and falls back to vendored `js/vendor/fflate.min.js`.
`npm` stays dev-only for the tests under `tests/`.

## Tasks

- [ ] 1. Set up the parity fixture and reference output
  - [ ] 1.1 Create the synthetic export.xml fixture
    - Create `tests/fixtures/apple_health_export/export.xml` with invented values only (no real health data), per steering privacy rules
    - Exercise the tricky cases: multiple sources with overlapping sleep intervals; asleep stages vs `InBed`/`Awake`; multiple values per day per metric; days missing some metrics; non-UTC timezone offsets; and values that stress 2-dp rounding including a Python banker's-rounding half-case
    - _Requirements: 5.5, 5.6, 5.7, 5.11_

  - [ ] 1.2 Generate the committed expected output from the reference parser
    - Run `scripts/parse_health.py` on the fixture to produce `tests/fixtures/expected-daily.json`
    - Document the exact regeneration command (e.g. in `tests/fixtures/README.md` or a comment at the top of the parity test) so drift can be caught in CI
    - _Requirements: 5.11_

- [ ] 2. Implement the pure parse-core module (`js/parse-core.js`)
  - [ ] 2.1 Scaffold parse-core with the dual-export pattern and constants
    - Create `js/parse-core.js` using the IIFE + `module.exports` guard that attaches `self.HuifanParseCore` (works via `importScripts` in a worker AND `createRequire` under vitest), matching `js/score.js` / `js/order.js`
    - Define named constants `TYPES` (the three quantity identifiers) and `ASLEEP_VALUES` (the five asleep stages), mirroring `scripts/parse_health.py`
    - _Requirements: 5.5_

  - [ ] 2.2 Implement timestamp, rounding, and daily-mean helpers
    - `parseAppleDateTime(s)` → `{ ms, dateISO }` mirroring Python `strptime("%Y-%m-%d %H:%M:%S %z")`, local date using the string's offset
    - `round2(x)` replicating Python `round(x, 2)` banker's rounding (round-half-to-even), NOT `Math.round`
    - `dailyMean(values)` → mean or `null` when empty (never 0), mirroring `mean_or_none`
    - `wakeDate(endDateISO)` → local calendar date of the interval end time
    - _Requirements: 5.2, 5.3, 5.4, 5.7, 5.8, 5.9, 5.10_

  - [ ]* 2.3 Write property test for rounding and null-not-zero
    - **Property 8: Rounding** — each daily mean and `sleep_h` has at most 2 decimals and equals the full-precision value rounded the way the reference parser rounds
    - **Property 7: Null-not-zero** — a metric with no values is `null`, zero merged sleep is `null`, and no present value is silently replaced by `0`
    - `// Feature: browser-onboarding, Property 8: ...` and `// Feature: browser-onboarding, Property 7: ...`; fast-check, min 100 iterations; load via `createRequire`
    - _Requirements: 5.2, 5.3, 5.4, 5.8, 5.9, 5.10_

  - [ ] 2.4 Implement interval merge and wake-date assignment
    - `mergeIntervals(intervals)` → total non-overlapping seconds; input need not be sorted; mirrors `merge_intervals`
    - _Requirements: 5.6, 5.7_

  - [ ]* 2.5 Write property tests for sleep interval merging
    - **Property 3: Sleep interval merging** — merged duration ≤ sum of individual durations, equal only when disjoint; a fully-contained interval does not change the result
    - **Property 4: Merge order independence** — merged duration is identical regardless of input order
    - **Property 5: Wake-date assignment** — a record's `date` equals the local calendar date of the interval's end time
    - **Property 6: Asleep-stage filtering** — `InBed`/`Awake` contribute zero; only the five asleep stages contribute
    - Tag each with `// Feature: browser-onboarding, Property {n}: ...`; fast-check, min 100 iterations; `createRequire`
    - _Requirements: 5.5, 5.6, 5.7_

  - [ ] 2.6 Implement the incremental XML scanner
    - `extractRecordsFromChunks()` → stateful scanner with `push(textChunk)` and accumulated `records`; a hand-written scan that finds complete `<Record .../>` elements, parses `type`/`value`/`startDate`/`endDate`, drops consumed text, and reassembles a Record split across chunk boundaries
    - MUST NOT use `DOMParser` or any DOM-based XML API (unavailable in workers)
    - Skip malformed individual records and continue (mirrors Python `except (ValueError, TypeError)`)
    - _Requirements: 2.3, 5.11_

  - [ ]* 2.7 Write property test for chunk-boundary independence
    - **Property 11: XML scan chunk-boundary independence** — for any XML text and any split into sequential chunks, feeding the chunks yields the same records as feeding the whole text at once
    - `// Feature: browser-onboarding, Property 11: ...`; fast-check with an arbitrary that splits generated XML at random boundaries; min 100 iterations
    - _Requirements: 2.3_

  - [ ] 2.8 Implement buildDaily and filterLastNMonths
    - `buildDaily(acc)` → sorted, unique-date `Daily_Record[]` with exactly `date`, `hrv`, `rhr`, `resp`, `sleep_h`; a direct port of `build_daily` over the `Accumulators` shape
    - `filterLastNMonths(rows, months)` → rows with `date >= maxDate - months`, window anchored on the most recent record date; range `"all"` skips the filter (identity)
    - _Requirements: 3.3, 3.4, 5.1, 5.9, 5.10_

  - [ ]* 2.9 Write property tests for shape and the range filter
    - **Property 2: Sort order and shape** — output sorted strictly ascending by `date`, no duplicate dates, exactly the five fields per row
    - **Property 9: Last-N-months filter** — "last 6 months" is exactly the subset of "everything" within 6 months of the most recent date; every filtered row appears in "everything"; "everything" equals the unfiltered dataset
    - Tag each with `// Feature: browser-onboarding, Property {n}: ...`; fast-check, min 100 iterations; `createRequire`
    - _Requirements: 3.3, 3.4, 5.1_

- [ ] 3. Write the parity gate test
  - [ ] 3.1 Stream the fixture through parse-core and assert reference parity
    - Create `tests/parse-core.parity.test.js` loading `js/parse-core.js` via `createRequire` (same approach as `tests/score.property.test.js`)
    - Read `tests/fixtures/apple_health_export/export.xml`, stream it through `extractRecordsFromChunks` + `buildDaily` (+ `filterLastNMonths` for the range cases), and assert deep equality with `tests/fixtures/expected-daily.json` field-for-field including `null`s and 2-dp numbers
    - **Property 1: Parse/reference parity** — the gate for Requirement 5.11
    - `// Feature: browser-onboarding, Property 1: ...`
    - _Requirements: 5.11, 5.2, 5.3, 5.4, 5.8_

- [ ] 4. Checkpoint - parse-core and parity
  - Ensure all parse-core and parity tests pass, ask the user if questions arise.

- [ ] 5. Vendor the streaming unzip helper
  - [ ] 5.1 Commit fflate as a static file with its license preserved
    - Add `js/vendor/fflate.min.js` (fflate, MIT, Copyright (c) Arjun Barrett) with its MIT license header preserved in the file; it is a committed static file loaded via `importScripts`, NOT an npm runtime dependency
    - _Requirements: 2.2, 2.4_

  - [ ] 5.2 Add a fflate attribution entry to the README
    - Add a credits/attribution section in `README.md` naming fflate, its link (https://github.com/101arrowz/fflate), and its MIT license (Copyright (c) Arjun Barrett)
    - _Requirements: 2.2_

- [ ] 6. Implement the parse worker (`js/parse-worker.js`)
  - [ ] 6.1 Scaffold the worker message protocol and lifecycle
    - Create `js/parse-worker.js` (I/O only, no DOM, no network); handle `{type:"parse", file, range}` and `{type:"cancel"}` in; post `progress` / `done` / `error`
    - Maintain a `cancelled` flag checked between chunks so `cancel` stops promptly
    - _Requirements: 2.1, 4.1, 4.3_

  - [ ] 6.2 Implement the streaming unzip adapter (`openXmlStream`)
    - Feature-detect native `DecompressionStream('deflate-raw')` and use it as the preferred path (read the local file header to locate the `export.xml` member and its byte range, pipe through `DecompressionStream` → `TextDecoderStream`)
    - Fall back to vendored fflate (loaded via `importScripts`) for zip-container edge cases (data-descriptor entries) and browsers lacking `DecompressionStream`
    - Never call `file.arrayBuffer()` on the whole file; stream via `file.stream()` / sliced `Blob` reads; locate the first member whose name ends with `export.xml` (matching `parse_health.py`)
    - Post `error: "not-a-zip"` when the bytes are not a readable zip; `error: "no-export-xml"` when no such member exists
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 4.4, 4.5_

  - [ ] 6.3 Wire the worker to parse-core and emit results
    - `importScripts("parse-core.js")`; feed decoded XML text chunks into the incremental scanner, accumulating across chunks without materializing the whole XML
    - On completion: `buildDaily`, apply `filterLastNMonths` when `range === "6m"`, post `{type:"done", rows}`; post `progress` with compressed bytes read as it advances
    - On any mid-parse failure post `error: "parse-failed"` and retain no rows
    - _Requirements: 2.2, 2.3, 3.3, 3.4, 4.1, 4.6, 5.1_

  - [ ]* 6.4 Write integration tests for the worker streaming pipeline
    - Drive `openXmlStream` + scanner over the fixture (or a mocked zip) and assert it never buffers the whole decompressed XML; assert `not-a-zip` and `no-export-xml` error paths retain no rows
    - _Requirements: 2.2, 2.3, 2.6, 4.4, 4.5, 4.6_

- [ ] 7. Implement the onboarding UI (`js/onboarding.js`)
  - [ ] 7.1 Scaffold the module, persistence helpers, and first-run predicate
    - Create `js/onboarding.js` following the IIFE + `window.HuifanOnboarding` pattern; export `STORAGE_KEY = "huifan.daily.v1"`, `shouldFirstRun`, `saveDataset`, `loadDataset`, `deleteDataset`, `mount`
    - `shouldFirstRun(storeValue, globalValue)` returns true only when neither holds a non-empty dataset
    - `saveDataset`/`loadDataset`/`deleteDataset` wrap all `localStorage` access in try/catch; `saveDataset` returns `false` when storage is unavailable; `deleteDataset` removes the key and clears `window.HUIFAN_DAILY`
    - _Requirements: 1.1, 6.1, 6.3, 6.4, 6.5_

  - [ ]* 7.2 Write unit tests for predicate and persistence
    - `shouldFirstRun` across the four store/global combinations (1.1)
    - **Property 10: Save/load round-trip** — saving a dataset and loading it back yields an equal dataset; tag `// Feature: browser-onboarding, Property 10: ...`; fast-check, min 100 iterations; `createRequire`
    - Storage-unavailable path: `saveDataset` returns false but the global is still set for the session
    - _Requirements: 1.1, 6.1, 6.5_

  - [ ] 7.3 Build the first-run screen, file picker, and range radios
    - In `mount(sectionId)`: render the three export steps (open Health, open profile, "Export All Health Data"), an `<input type="file" accept=".zip">`, the one-line privacy statement, and two range radios ("Last 6 months" default, "Everything") mapping to `range: "6m" | "all"`
    - Add a `matchMedia("(max-width: 480px)")` note that uploading from a computer is easier, without blocking the picker
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 7.1, 7.2, 7.3_

  - [ ] 7.4 Wire worker lifecycle: progress, cancel, errors, success
    - On file select, create the worker and post `{type:"parse", file, range}`; show a determinate progress bar from `progress` messages and a Cancel button that calls `worker.terminate()` + posts `cancel`, discards partial state, and returns to the picker
    - Map each `error.reason` (`not-a-zip`/`no-export-xml` → one friendly "doesn't look like an Apple Health export" line; `parse-failed` → calm error) to copy, discard partial data, never save, and return to the picker; treat worker `onerror` as `parse-failed`
    - On `done`: `saveDataset(rows)`, set `window.HUIFAN_DAILY = rows`, call the app re-render entry; add a "Delete my data" control calling `deleteDataset()` and returning to first-run
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 7.5 Write example tests for the UI flow
    - Mount shows the three steps, picker, privacy line, range radios with "Last 6 months" default, and delete control (1.2–1.4, 3.1, 3.2, 6.3)
    - Cancel terminates the worker and saves nothing (4.3); error reasons map to friendly copy and return to the picker (4.4–4.6)
    - No network call during a parse: mock `fetch`/`XMLHttpRequest`/`sendBeacon`, assert zero calls (2.5)
    - Phone-width note appears under a narrow media query without blocking the picker (7.2, 7.3)
    - _Requirements: 1.2, 1.3, 1.4, 2.5, 3.1, 3.2, 4.3, 4.4, 4.5, 4.6, 6.3, 7.2, 7.3_

- [ ] 8. Wire onboarding into the app (`index.html`, `js/app.js`)
  - [ ] 8.1 Add the bootstrap hydration before app.js
    - Add a small bootstrap (inline script or `js/bootstrap.js`) placed BEFORE `js/app.js` that reads `localStorage["huifan.daily.v1"]` in try/catch and, when present, assigns `window.HUIFAN_DAILY` so `pickDataSource()` sees real data; `data/daily.js` still wins if committed (loads first)
    - Add the `#onboarding-section` container and load `js/onboarding.js`
    - Add the honest "onboarding needs a served (http) context" note in the UI and README
    - _Requirements: 6.2_

  - [ ] 8.2 Expose a re-render hook in app.js and mount onboarding
    - Expose the boot/render routine as `window.HuifanApp.render()` and call it from both the `DOMContentLoaded` handler and onboarding success, so a successful parse re-renders without a full reload
    - Call `HuifanOnboarding.mount("onboarding-section")`; show onboarding when `shouldFirstRun` is true, otherwise stay out of the way; verify a `<7`-day dataset saves, completes onboarding, and the app keeps "still learning your baseline"
    - _Requirements: 1.1, 6.2, 8.1, 8.2_

  - [ ]* 8.3 Write integration test for the data-source seam
    - After a successful parse, `pickDataSource()` returns `source: "real"` from `window.HUIFAN_DAILY`; a `<7`-day dataset still completes and the app shows "still learning your baseline"
    - _Requirements: 6.1, 6.2, 8.1, 8.2_

- [ ]* 9. Optional large-export streaming check
  - [ ]* 9.1 Add an optional heavy-fixture streaming test
    - Generate a ~tens-of-MB synthetic export (no real data) and confirm the worker completes and stays streaming without buffering the whole decompressed XML; keep it out of the default fast run
    - _Requirements: 2.4_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP (all are test or heavy-fixture tasks; no core implementation is optional).
- Each task references specific requirement sub-clauses and/or design properties for traceability.
- The parity test (3.1) is the gate for Requirement 5.11 — `round2` must match Python's banker's rounding on the fixture.
- Property-based tests use fast-check with at least 100 iterations each and are loaded via `createRequire`, matching the existing `tests/score.property.test.js`.
- `js/parse-core.js` must stay pure (no DOM, no Worker, no I/O) so the worker and the tests share it; the XML scanner must never use `DOMParser`.
- Streaming unzip prefers native `DecompressionStream('deflate-raw')` and falls back to vendored fflate; fflate's MIT notice must be preserved and credited.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "5.2"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6"] },
    { "id": 3, "tasks": ["2.3", "2.5", "2.7", "2.8"] },
    { "id": 4, "tasks": ["2.9", "3.1"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["6.3"] },
    { "id": 7, "tasks": ["6.4", "7.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 9, "tasks": ["7.5", "8.1"] },
    { "id": 10, "tasks": ["8.2"] },
    { "id": 11, "tasks": ["8.3", "9.1"] }
  ]
}
```
