// insights-core.js — per-user insights, computed in the browser. PURE: no DOM,
// no network. Mirrors scripts/insights.py field-for-field (parity test gates it).
//
// Dual export (same as score.js / parse-core.js): attaches to a global AND sets
// module.exports for vitest via createRequire.
//
// Parity-critical choices (see tasks.md parity notes):
//  - Shared mulberry32 PRNG, identical 32-bit stream in JS and Python.
//  - Neumaier compensated summation everywhere a mean/sum is taken (matches
//    CPython sum()); Pearson r, OLS, RMSE all built on it.
//  - CV folds are deterministic by date order (no PRNG); only the bootstrap
//    draws from the PRNG.

(function (root) {
  "use strict";

  // --- Constants (pinned; mirrored in insights.py) ----------------------
  var SEED = 0x9e3779b9;          // fixed PRNG seed
  var BASELINE_DAYS = 30;          // rolling baseline window (prior days)
  var MIN_BASELINE_HISTORY = 7;    // min prior HRV values to form a baseline
  var MIN_PAIRS = 10;              // Enough_Threshold for a slope
  var BOOT_ITERS = 5000;           // bootstrap resamples
  var CV_FOLDS = 5;                // time-ordered folds
  var NEGLIGIBLE_RMSE = 0.1;       // |rmse diff| <= this -> "negligible"
  var SHORT_SLEEP_H = 7;           // nights under this count as short
  var RHR_RANGE = [60, 100];       // adult resting-HR context range (bpm)
  // Device-change (mirror insights.py)
  var MIN_SEG_DAYS = 60;
  var STEP_FACTOR = 1.0;

  // --- Shared PRNG: mulberry32 (identical stream to Python) --------------
  function makeRng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- Summation / stats (Neumaier; no library reductions) --------------
  function neumaierSum(values) {
    var sum = 0.0, c = 0.0;
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      var t = sum + x;
      if (Math.abs(sum) >= Math.abs(x)) c += (sum - t) + x;
      else c += (x - t) + sum;
      sum = t;
    }
    return sum + c;
  }
  function mean(values) {
    if (values.length === 0) return NaN;
    return neumaierSum(values) / values.length;
  }
  function pearsonR(x, y) {
    var n = x.length;
    if (n < 2) return NaN;
    var mx = mean(x), my = mean(y);
    var dx = new Array(n), dy = new Array(n);
    for (var i = 0; i < n; i++) { dx[i] = x[i] - mx; dy[i] = y[i] - my; }
    var sxy = [], sxx = [], syy = [];
    for (var j = 0; j < n; j++) { sxy.push(dx[j]*dy[j]); sxx.push(dx[j]*dx[j]); syy.push(dy[j]*dy[j]); }
    var cov = neumaierSum(sxy), vx = neumaierSum(sxx), vy = neumaierSum(syy);
    var denom = Math.sqrt(vx * vy);
    if (denom === 0) return NaN;
    var r = cov / denom;
    // Clamp tiny floating-point overshoot; Pearson r is defined on [-1, 1].
    if (r > 1) r = 1; else if (r < -1) r = -1;
    return r;
  }
  // OLS y ~ x via the closed-form slope/intercept (built on Neumaier sums).
  function olsSlopeIntercept(x, y) {
    var n = x.length;
    var mx = mean(x), my = mean(y);
    var num = [], den = [];
    for (var i = 0; i < n; i++) { num.push((x[i]-mx)*(y[i]-my)); den.push((x[i]-mx)*(x[i]-mx)); }
    var dsum = neumaierSum(den);
    var slope = dsum === 0 ? 0 : neumaierSum(num) / dsum;
    var intercept = my - slope * mx;
    return { slope: slope, intercept: intercept };
  }
  function rmse(pred, actual) {
    var n = pred.length;
    if (n === 0) return NaN;
    var sq = [];
    for (var i = 0; i < n; i++) { var e = pred[i]-actual[i]; sq.push(e*e); }
    return Math.sqrt(neumaierSum(sq) / n);
  }
  function quantile(sortedAsc, q) {
    // numpy's 'linear' interpolation (default), matching np.quantile.
    var n = sortedAsc.length;
    if (n === 0) return NaN;
    if (n === 1) return sortedAsc[0];
    var pos = q * (n - 1);
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sortedAsc[lo];
    var frac = pos - lo;
    return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
  }

  // --- Rounding (Python round(x,ndigits) banker's rounding) -------------
  function roundN(x, nd) {
    if (typeof x !== "number" || !isFinite(x)) return x;
    if (x < 0) { var r = roundN(-x, nd); return r === 0 ? 0 : -r; }
    var s = x.toFixed(25);
    var dot = s.indexOf("."), intPart = s.slice(0, dot), frac = s.slice(dot + 1);
    var keep = frac.slice(0, nd).padEnd(nd, "0");
    var rest = frac.slice(nd);
    var scaled = BigInt(intPart) * (10n ** BigInt(nd)) + BigInt(keep || "0");
    var first = rest[0] || "0", up;
    if (first > "5") up = true;
    else if (first < "5") up = false;
    else { var tail = rest.slice(1).replace(/0+$/, ""); up = tail.length ? true : (scaled % 2n === 1n); }
    if (up) scaled += 1n;
    return Number(scaled) / Number(10n ** BigInt(nd));
  }

  // --- Dates ------------------------------------------------------------
  function toOrdinal(iso) {
    var p = iso.split("-");
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
  }

  // --- Baseline-adjusted HRV + pairing ----------------------------------
  // Returns a map date->adjustedHRV for days that have a baseline.
  function baselineAdjustedByDate(rows) {
    var sorted = rows.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var adj = {};
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      if (typeof r.hrv !== "number") continue;
      var ord = toOrdinal(r.date);
      var prior = [];
      for (var j = 0; j < sorted.length; j++) {
        var rj = sorted[j];
        if (typeof rj.hrv !== "number") continue;
        var oj = toOrdinal(rj.date);
        if (oj < ord && oj >= ord - BASELINE_DAYS) prior.push(rj.hrv);
      }
      if (prior.length < MIN_BASELINE_HISTORY) continue;
      adj[r.date] = r.hrv - mean(prior);
    }
    return adj;
  }

  // Pairs: night N sleep -> morning N+1 adjusted HRV, consecutive days, both
  // present, labeled by morning date. Also attaches sleep_debt_3n when the
  // three prior nights all have sleep.
  function buildPairs(rows) {
    var byDate = {};
    rows.forEach(function (r) { byDate[r.date] = r; });
    var adj = baselineAdjustedByDate(rows);
    var sorted = rows.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var pairs = [];
    sorted.forEach(function (r) {
      var s = r.sleep_h;
      if (typeof s !== "number") return;
      var nextIso = isoFromOrdinal(toOrdinal(r.date) + 1);
      if (!(nextIso in adj)) return;
      // sleep_debt_3n: nights N, N-1, N-2 (N = r.date and two before)
      var n1 = byDate[r.date];
      var n2 = byDate[isoFromOrdinal(toOrdinal(r.date) - 1)];
      var n3 = byDate[isoFromOrdinal(toOrdinal(r.date) - 2)];
      var debt = null;
      if (n1 && n2 && n3 && typeof n1.sleep_h === "number" && typeof n2.sleep_h === "number" && typeof n3.sleep_h === "number") {
        debt = n1.sleep_h + n2.sleep_h + n3.sleep_h;
      }
      pairs.push({ date: nextIso, sleep: s, adj_hrv: adj[nextIso], debt3n: debt });
    });
    pairs.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return pairs;
  }
  function isoFromOrdinal(ord) {
    var d = new Date(ord * 86400000);
    return d.toISOString().slice(0, 10);
  }

  // --- Device-change (mirror insights.py detect_device_change) ----------
  function sampleVar(vals) {
    var n = vals.length;
    if (n < 2) return 0;
    var m = mean(vals), sq = [];
    for (var i = 0; i < n; i++) sq.push((vals[i]-m)*(vals[i]-m));
    return neumaierSum(sq) / (n - 1);
  }
  function detectDeviceChange(rows) {
    var series = rows.filter(function (r) { return typeof r.hrv === "number"; })
      .map(function (r) { return [r.date, r.hrv]; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    var n = series.length;
    if (n < 2 * MIN_SEG_DAYS) return { changed: false, boundary_date: null, segments: [] };
    var vals = series.map(function (t) { return t[1]; });
    var best = { score: 0, idx: null };
    for (var i = MIN_SEG_DAYS; i < n - MIN_SEG_DAYS; i++) {
      var left = vals.slice(0, i), right = vals.slice(i);
      var pooled = Math.sqrt((sampleVar(left)*(left.length-1) + sampleVar(right)*(right.length-1)) / (n - 2));
      if (pooled === 0) continue;
      var score = Math.abs(mean(right) - mean(left)) / pooled;
      if (score > best.score) best = { score: score, idx: i };
    }
    if (best.idx === null || best.score < STEP_FACTOR) return { changed: false, boundary_date: null, segments: [] };
    var i2 = best.idx, lv = vals.slice(0, i2), rv = vals.slice(i2);
    return {
      changed: true,
      boundary_date: series[i2][0],
      step_sd_units: roundN(best.score, 2),
      segments: [
        { from: series[0][0], to: series[i2-1][0], n: lv.length, mean_hrv: roundN(mean(lv), 1) },
        { from: series[i2][0], to: series[n-1][0], n: rv.length, mean_hrv: roundN(mean(rv), 1) }
      ]
    };
  }

  // --- Slope analysis + bootstrap CI ------------------------------------
  function analyzeWindow(pairs, rng) {
    var n = pairs.length;
    if (n < MIN_PAIRS) return { n_pairs: n, enough: false };
    var sleep = pairs.map(function (p) { return p.sleep; });
    var hrv = pairs.map(function (p) { return p.adj_hrv; });
    var r = pearsonR(sleep, hrv);
    var fit = olsSlopeIntercept(sleep, hrv);
    var slopes = new Array(BOOT_ITERS);
    for (var b = 0; b < BOOT_ITERS; b++) {
      var rs = new Array(n), rh = new Array(n);
      for (var k = 0; k < n; k++) { var idx = Math.floor(rng() * n); rs[k] = sleep[idx]; rh[k] = hrv[idx]; }
      slopes[b] = olsSlopeIntercept(rs, rh).slope;
    }
    slopes.sort(function (a, b) { return a - b; });
    var lo = quantile(slopes, 0.025), hi = quantile(slopes, 0.975);
    return {
      n_pairs: n, enough: true,
      pearson_r: roundN(r, 3),
      slope_ms_per_hour: roundN(fit.slope, 2),
      intercept: roundN(fit.intercept, 2),
      slope_ci_low: roundN(lo, 2),
      slope_ci_high: roundN(hi, 2),
      slope_excludes_zero: lo > 0 || hi < 0,
      date_from: pairs[0].date,
      date_to: pairs[n-1].date
    };
  }

  // --- Sleep-debt CV comparison -----------------------------------------
  function foldSlices(n, k) {
    // Contiguous equal-ish folds; remainder to later folds (match Python).
    var base = Math.floor(n / k), rem = n % k, slices = [], start = 0;
    for (var f = 0; f < k; f++) {
      var size = base + (f >= k - rem ? 1 : 0);
      slices.push([start, start + size]);
      start += size;
    }
    return slices;
  }
  function cvRmse(feature, target) {
    // feature/target already date-sorted & aligned. Forward-chaining folds.
    var n = feature.length;
    if (n < CV_FOLDS) return null;
    var slices = foldSlices(n, CV_FOLDS);
    var fold_rmses = [];
    for (var f = 1; f < CV_FOLDS; f++) {
      var testStart = slices[f][0], testEnd = slices[f][1];
      var trX = feature.slice(0, testStart), trY = target.slice(0, testStart);
      var teX = feature.slice(testStart, testEnd), teY = target.slice(testStart, testEnd);
      if (trX.length < 2 || teX.length === 0) continue;
      var fit = olsSlopeIntercept(trX, trY);
      var pred = teX.map(function (xv) { return fit.slope * xv + fit.intercept; });
      fold_rmses.push(rmse(pred, teY));
    }
    if (fold_rmses.length === 0) return null;
    return mean(fold_rmses);
  }
  function sleepDebtComparison(pairs) {
    // last-night model uses all pairs; debt model uses pairs with debt3n.
    var lastX = pairs.map(function (p) { return p.sleep; });
    var lastY = pairs.map(function (p) { return p.adj_hrv; });
    var debtPairs = pairs.filter(function (p) { return typeof p.debt3n === "number"; });
    var debtX = debtPairs.map(function (p) { return p.debt3n; });
    var debtY = debtPairs.map(function (p) { return p.adj_hrv; });
    if (pairs.length < CV_FOLDS || debtPairs.length < CV_FOLDS) {
      return { enough: false, n_pairs: pairs.length, n_debt_pairs: debtPairs.length };
    }
    var rmseLast = cvRmse(lastX, lastY);
    var rmseDebt = cvRmse(debtX, debtY);
    if (rmseLast === null || rmseDebt === null) return { enough: false, n_pairs: pairs.length, n_debt_pairs: debtPairs.length };
    var diff = Math.abs(rmseLast - rmseDebt);
    var verdict;
    if (diff <= NEGLIGIBLE_RMSE) verdict = "negligible";
    else verdict = rmseLast < rmseDebt ? "last_night" : "sleep_debt";
    return {
      enough: true,
      rmse_last_night: roundN(rmseLast, 2),
      rmse_sleep_debt: roundN(rmseDebt, 2),
      verdict: verdict,
      n_pairs: pairs.length,
      n_debt_pairs: debtPairs.length
    };
  }

  // --- Reference section (NO HRV population comparison) ------------------
  function shortSleepShare(rows) {
    var nights = rows.filter(function (r) { return typeof r.sleep_h === "number"; });
    if (nights.length === 0) return null;
    var short = nights.filter(function (r) { return r.sleep_h < SHORT_SLEEP_H; }).length;
    return { share: roundN(short / nights.length, 3), n_nights: nights.length, short_nights: short };
  }
  function restingHrContext(rows) {
    var vals = rows.filter(function (r) { return typeof r.rhr === "number"; }).map(function (r) { return r.rhr; });
    if (vals.length === 0) return null;
    return { mean_rhr: roundN(mean(vals), 1), adult_range_low: RHR_RANGE[0], adult_range_high: RHR_RANGE[1], n: vals.length };
  }

  // --- Top-level --------------------------------------------------------
  function computeInsights(rows, opts) {
    opts = opts || {};
    var seed = typeof opts.seed === "number" ? opts.seed : SEED;
    var cdc = opts.cdc || null; // caller passes CDC Suffolk figure passthrough

    var device = detectDeviceChange(rows);
    var pairs = buildPairs(rows);
    var full = analyzeWindow(pairs, makeRng(seed));

    var analysis_window = "full";
    var recent = null;
    if (device.changed) {
      var boundary = device.boundary_date;
      var kept = pairs.filter(function (p) { return p.date >= boundary; });
      if (kept.length >= MIN_PAIRS) {
        recent = analyzeWindow(kept, makeRng(seed + 1));
        analysis_window = "recent_segment";
      }
    }
    var primary = (recent && recent.enough) ? recent : full;
    var cvPairs = (analysis_window === "recent_segment")
      ? pairs.filter(function (p) { return p.date >= device.boundary_date; })
      : pairs;

    return {
      n_pairs_total: full.n_pairs || 0,
      device_change: device,
      analysis_window: analysis_window,
      primary: primary,
      full_history: full,
      recent_segment: recent,
      sleep_debt: sleepDebtComparison(cvPairs),
      reference: {
        short_sleep: shortSleepShare(rows),
        resting_hr: restingHrContext(rows),
        cdc_context: cdc,
        recommended_sleep_h: SHORT_SLEEP_H,
        hrv_norm_comparison: false, // we deliberately never compare HRV to norms
        hrv_note: "Between-person HRV variation is large and wearable HRV is not comparable to clinical norms, so only your own baseline is used."
      },
      note: "Lagged association from one person's own history. Correlation is not causation; this is a personal planning aid, not medical advice."
    };
  }

  var api = {
    SEED: SEED, BASELINE_DAYS: BASELINE_DAYS, MIN_BASELINE_HISTORY: MIN_BASELINE_HISTORY,
    MIN_PAIRS: MIN_PAIRS, BOOT_ITERS: BOOT_ITERS, CV_FOLDS: CV_FOLDS,
    NEGLIGIBLE_RMSE: NEGLIGIBLE_RMSE, SHORT_SLEEP_H: SHORT_SLEEP_H,
    makeRng: makeRng, neumaierSum: neumaierSum, mean: mean, pearsonR: pearsonR,
    olsSlopeIntercept: olsSlopeIntercept, rmse: rmse, quantile: quantile, roundN: roundN,
    baselineAdjustedByDate: baselineAdjustedByDate, buildPairs: buildPairs,
    detectDeviceChange: detectDeviceChange, analyzeWindow: analyzeWindow,
    sleepDebtComparison: sleepDebtComparison, shortSleepShare: shortSleepShare,
    computeInsights: computeInsights
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HuifanInsightsCore = api;
})(typeof self !== "undefined" ? self : this);
