---
inclusion: always
---

# 烩饭 — tech

## Stack (keep it this small)
- **Web app:** plain HTML + CSS + vanilla JavaScript. No framework, no build step, no npm install required to run. Opening `index.html` (or a simple local static server) must be enough.
- **Data prep:** one Python 3 script, standard library only (`xml.etree.ElementTree` iterparse, `json`, `zipfile`, `datetime`). No pandas.
- **Storage:** browser `localStorage` for the daily history, wrapped in try/catch; the app must still work if storage is unavailable.
- **No backend, no database, no external APIs at runtime.** The CDC file is downloaded once and committed as a static JSON.

## Apple Health export
- iPhone Health app → profile → Export All Health Data → `export.zip` containing `apple_health_export/export.xml`.
- export.xml can be hundreds of MB. **Never parse it in the browser.** Stream it in Python with `iterparse` and clear elements as you go.
- Record types to extract:
  - `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` (ms) → daily mean
  - `HKQuantityTypeIdentifierRestingHeartRate` (bpm) → daily value
  - `HKCategoryTypeIdentifierSleepAnalysis` → total asleep hours per night. Count asleep stages (`Asleep`, `AsleepCore`, `AsleepDeep`, `AsleepREM`, `AsleepUnspecified`), not `InBed` or `Awake`. Assign a night to the date the user woke up. Merge overlapping intervals from multiple sources so sleep is not double-counted.
- Output: `data/daily.json` — a list of `{ "date": "YYYY-MM-DD", "hrv": number|null, "rhr": number|null, "sleep_h": number|null }`, sorted by date. Missing values are `null`, never 0.
- **Real health exports must never be committed.** `export.zip`, `export.xml`, and real `daily.json` go in `.gitignore`. Commit a small synthetic `data/sample-daily.json` for the demo and for anyone cloning the repo.

## Recovery score (deterministic, explainable)
- Baseline: each metric's mean and standard deviation over the previous 30 days (excluding today). Need at least 7 days with data; otherwise show "still learning your baseline" instead of a score.
- Per metric z-score vs baseline. HRV higher = better; resting HR lower = better (invert sign); sleep higher = better.
- Combine into one 0–100 score (50 = a normal day for this user). Skip metrics that are missing today and re-weight the rest. Keep weights in one clearly named constant so they can be tuned.
- Always produce a one-line reason naming the biggest contributor(s).
- Bands: high / normal / low. Thresholds live in one constant.

## Reordering
- Input: the user's tasks, each with an effort level the user chooses (e.g. heavy / medium / light).
- Output: the **same tasks**, reordered. Never add, remove, rename, or merge tasks.
- Default rule: high recovery → heavy tasks first; low recovery → light tasks first, heavy tasks later; normal → keep the user's original order mostly intact. Ties keep the user's original order (stable sort).
- Put the rule in one small pure function so it's easy to test and change.

## Code style
- Small, readable functions; comments in English.
- Pure functions for parsing, scoring and ordering (no DOM access inside them).
- Mobile-friendly layout (works at phone width).
- Support light and dark mode via CSS variables.
