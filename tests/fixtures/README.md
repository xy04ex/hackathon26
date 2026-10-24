# Test fixtures for browser-onboarding parity

These files are **synthetic** — invented values, no real health data (per the
project's privacy rules). They are safe to commit.

## Files

- `apple_health_export/export.xml` — a small hand-written Apple Health export
  that exercises the tricky parse cases:
  - HRV with two values on one day whose mean is a banker's-rounding half case
    (`(50.10 + 50.15) / 2 = 50.125` → Python `round` = `50.12`, not `50.13`).
  - Sleep from two sources with **overlapping** intervals that must merge to a
    single union (not double-counted), with `InBed` and `Awake` ignored.
  - A fully **contained** sleep interval that must not change the merged total.
  - A day missing some metrics (null, never 0) and a night with no sleep (null).
  - A **malformed** record (non-numeric value) that must be skipped.
  - A non-`Record` type (`StepCount`) the scanner must ignore.
  - A different timezone offset (`-0800`) to stress date assignment.
- `expected-daily.json` — the reference output produced by `parse_health.py`
  over the fixture. The JS parser's output must equal this field-for-field.

## Regenerating `expected-daily.json`

The reference parser writes to `data/` (git-ignored), so regenerate and copy:

```sh
python3 scripts/parse_health.py tests/fixtures/apple_health_export/export.xml
cp data/daily.json tests/fixtures/expected-daily.json
rm -f data/daily.json data/daily.js   # keep real-data paths clean
```

Run this if you change the fixture; the parity test (`tests/parse-core.parity.test.js`)
asserts the JS parse-core output matches this file.
