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
  - `HKQuantityTypeIdentifierRespiratoryRate` (breaths/min) → daily mean
  - `HKCategoryTypeIdentifierSleepAnalysis` → total asleep hours per night. Count asleep stages (`Asleep`, `AsleepCore`, `AsleepDeep`, `AsleepREM`, `AsleepUnspecified`), not `InBed` or `Awake`. Assign a night to the date the user woke up. Merge overlapping intervals from multiple sources so sleep is not double-counted.
- Output: `data/daily.json` — a list of `{ "date": "YYYY-MM-DD", "hrv": number|null, "rhr": number|null, "resp": number|null, "sleep_h": number|null }`, sorted by date. Missing values are `null`, never 0.
- **Real health exports must never be committed.** `export.zip`, `export.xml`, and real `daily.json` go in `.gitignore`. Commit a small synthetic `data/sample-daily.json` for the demo and for anyone cloning the repo.

## Recovery score (deterministic, explainable — DO NOT reinvent)
This is the user's real, working algorithm. Keep it exactly; put every number in a named constant.
- Baseline: mean and **sample** SD (n−1) of the previous 30 days, **excluding today**.
- z = (today − mean) / SD for HRV, resting HR, and respiratory rate.
- Sleep is NOT baseline-compared: `sleep_z = (hours_asleep − 8) / 1`, clamped to [−3, +1.5].
- `composite = 0.40·z_hrv − 0.25·z_rhr + 0.25·z_sleep − 0.10·z_resp`. If a metric is missing today, drop its term and keep the ratios among the present metrics (re-weight).
- `score = round(100 / (1 + e^(−composite)))`.
- Bands: **≥67 green, 34–66 yellow, ≤33 red**. Thresholds live in one constant.
- Need at least 7 baseline days for the baseline-compared metrics; otherwise show "still learning your baseline" instead of a score.
- Always produce a one-line reason naming the biggest contributor(s).

## Reordering (evidence-based defaults — DO NOT reinvent)
- Input: the user's tasks, each with a **type** (deep work / reading / admin / physical / social) and optional **effort 1–3**. Optional due date (today / tomorrow / later).
- Output: the **same tasks**, reordered. Never add, remove, rename, or merge tasks. Ties keep the user's original order (stable sort).
- Default rules, in order:
  1. Tasks due today or tomorrow always go first, regardless of score.
  2. If sleep < 6 h: put one <10-minute task first, and split the most demanding task into 20–25 minute chunks.
  3. Do NOT move cognitively demanding tasks later just because HRV is low (the HRV–cognition link is between-person, not within-person day to day).
  4. Learned adjustment: only move a task type later on low-recovery days once the patterns page shows that type's completion actually drops on low days with a credible interval excluding no effect.
- Show which rule moved each task.
- Put the rule in one small pure function so it's easy to test and change.

## Code style
- Small, readable functions; comments in English.
- Pure functions for parsing, scoring and ordering (no DOM access inside them).
- Mobile-friendly layout (works at phone width).
- Support light and dark mode via CSS variables.
