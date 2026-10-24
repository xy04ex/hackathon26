// score.js — personal recovery score (pure functions, no DOM).
//
// This is the user's real, locked algorithm. Do not reinvent it.
// Every number lives in a named constant below so it is easy to audit/tune.

// --- Tunable constants (the locked algorithm) ---------------------------

// How many prior days form the baseline, and the minimum we need before we
// trust a baseline for the z-scored metrics.
const BASELINE_DAYS = 30;
const MIN_BASELINE_DAYS = 7;

// Composite weights. Sign matters: HRV up = good, resting HR up = bad,
// sleep up = good, respiratory rate up = bad.
const WEIGHTS = {
  hrv: 0.40,
  rhr: -0.25,
  sleep: 0.25,
  resp: -0.10,
};

// Sleep is NOT compared to the personal baseline. It is scored against a
// fixed 8-hour target, then clamped.
const SLEEP_TARGET_H = 8;
const SLEEP_SCALE = 1; // one hour from target == one "z" unit
const SLEEP_Z_MIN = -3;
const SLEEP_Z_MAX = 1.5;

// Score bands.
const BAND_GREEN_MIN = 67; // >= 67 -> green
const BAND_RED_MAX = 33; // <= 33 -> red; 34..66 -> yellow

// Human-readable labels for the reason line.
const METRIC_LABELS = {
  hrv: "HRV",
  rhr: "resting HR",
  sleep: "sleep",
  resp: "respiratory rate",
};

// --- Baseline helpers ---------------------------------------------------

/** Sample mean of an array of numbers. */
function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1). Returns null if fewer than 2 values. */
function sampleStdDev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance =
    values.reduce((a, b) => a + (b - m) * (b - m), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Collect the previous BASELINE_DAYS rows before `todayIndex` (excluding
 * today) and return the non-null values for one metric key.
 */
function baselineValues(rows, todayIndex, key) {
  const start = Math.max(0, todayIndex - BASELINE_DAYS);
  const slice = rows.slice(start, todayIndex); // excludes today
  return slice
    .map((r) => r[key])
    .filter((v) => typeof v === "number" && !Number.isNaN(v));
}

/**
 * z = (today - mean) / sd against the baseline window.
 * Returns null if there isn't enough baseline data or sd is zero/undefined.
 */
function baselineZ(rows, todayIndex, key) {
  const today = rows[todayIndex][key];
  if (typeof today !== "number" || Number.isNaN(today)) return null;
  const base = baselineValues(rows, todayIndex, key);
  if (base.length < MIN_BASELINE_DAYS) return null;
  const sd = sampleStdDev(base);
  if (sd === null || sd === 0) return null;
  return (today - mean(base)) / sd;
}

/** Sleep z against the fixed 8h target, clamped. Null if sleep missing. */
function sleepZ(sleepHours) {
  if (typeof sleepHours !== "number" || Number.isNaN(sleepHours)) return null;
  const z = (sleepHours - SLEEP_TARGET_H) / SLEEP_SCALE;
  return Math.max(SLEEP_Z_MIN, Math.min(SLEEP_Z_MAX, z));
}

// --- Score --------------------------------------------------------------

/** Map a 0..100 score to a band. */
function bandFor(score) {
  if (score >= BAND_GREEN_MIN) return "green";
  if (score <= BAND_RED_MAX) return "red";
  return "yellow";
}

/**
 * Compute the recovery score for rows[todayIndex].
 *
 * rows: array sorted by date ascending, each { date, hrv, rhr, resp, sleep_h }.
 * Returns one of:
 *   { ok: false, reason: "learning" }   // not enough baseline yet
 *   { ok: true, score, band, composite, contributions, reason }
 *
 * Re-weighting: if a metric is missing today (or lacks baseline), its term is
 * dropped and the remaining weights are renormalised to keep their ratios.
 */
function computeRecovery(rows, todayIndex) {
  const todayRow = rows[todayIndex];

  // Gather each available z-score.
  const z = {
    hrv: baselineZ(rows, todayIndex, "hrv"),
    rhr: baselineZ(rows, todayIndex, "rhr"),
    resp: baselineZ(rows, todayIndex, "resp"),
    sleep: sleepZ(todayRow.sleep_h),
  };

  // Which metrics are present today?
  const present = Object.keys(WEIGHTS).filter((k) => z[k] !== null);

  // We need at least one baseline-compared metric (hrv/rhr/resp) with data;
  // if only sleep is available we can't claim a baseline-aware score.
  const baselineMetricsPresent = present.filter((k) => k !== "sleep");
  if (baselineMetricsPresent.length === 0) {
    return { ok: false, reason: "learning" };
  }

  // Re-normalise weights across present metrics so their absolute values sum
  // to 1 (keeps each metric's ratio and sign). When every metric is present
  // this equals the original weights exactly, since |weights| already sum to 1.
  const totalAbs = present.reduce((a, k) => a + Math.abs(WEIGHTS[k]), 0);
  const contributions = {};
  let composite = 0;
  for (const k of present) {
    const w = WEIGHTS[k] / totalAbs;
    const term = w * z[k];
    contributions[k] = { z: z[k], weight: w, term };
    composite += term;
  }

  const score = Math.round(100 / (1 + Math.exp(-composite)));
  const band = bandFor(score);

  return {
    ok: true,
    score,
    band,
    composite,
    contributions,
    reason: buildReason(contributions, todayRow),
  };
}

/**
 * One-line reason naming the biggest contributor(s) to today's score.
 * Picks the metric whose term moved the composite most (either direction).
 */
function buildReason(contributions, todayRow) {
  const entries = Object.entries(contributions);
  if (entries.length === 0) return "No metrics available today.";

  // Biggest absolute term wins.
  entries.sort((a, b) => Math.abs(b[1].term) - Math.abs(a[1].term));
  const [key, info] = entries[0];
  const label = METRIC_LABELS[key];
  const direction = info.term >= 0 ? "lifting" : "lowering";

  if (key === "sleep") {
    const h = todayRow.sleep_h;
    return `Sleep ${h} h is ${direction} today's score the most.`;
  }
  const pct = Math.round(Math.abs(info.z) * 100) / 100;
  const vs = info.z >= 0 ? "above" : "below";
  return `${label} ${pct}σ ${vs} your usual is ${direction} today's score the most.`;
}

// Expose for the browser (no module system in this no-build app) and for Node
// tests if ever run.
if (typeof window !== "undefined") {
  window.HuifanScore = { computeRecovery, bandFor, BAND_GREEN_MIN, BAND_RED_MAX };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeRecovery, bandFor, sleepZ, sampleStdDev };
}
