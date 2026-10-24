// patterns-core.js — Beta-Binomial completion rates by task type x recovery
// tier, computed in the browser on the user's OWN logs. PURE (no DOM/network).
// Mirrors scripts/patterns.py field-for-field (parity test gates it).
//
// Deterministic: no Monte-Carlo. Cell credible intervals come from the inverse
// regularized incomplete beta; the green-minus-red difference interval comes
// from a shared fixed-grid convolution of the two Beta posteriors. The SAME
// method is implemented in patterns.py so results match to 4 dp. No RNG.
//
// Dual export (global + module.exports), like score.js / insights-core.js.

(function (root) {
  "use strict";

  var TIERS = ["green", "yellow", "red"];
  var PRIOR_STRENGTH = 8.0;
  var CI_MASS = 0.94;
  // Clamp the prior mean so a 100%/0% overall rate can't produce a
  // degenerate Beta(k0,0)/Beta(0,k0) prior (improper posterior for empty
  // cells). A real user CAN hit a 100% or 0% completion rate.
  var PRIOR_MEAN_MIN = 0.01, PRIOR_MEAN_MAX = 0.99;
  var CI_LO = (1 - CI_MASS) / 2; // 0.03
  var CI_HI = 1 - CI_LO;         // 0.97
  var GRID = 1000;               // difference-grid resolution (shared with py)

  // --- lgamma (Lanczos), matches math.lgamma closely enough for betacf ------
  var G7 = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  function logGamma(z) {
    if (z < 0.5) {
      // reflection
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    z -= 1;
    var x = G7[0];
    for (var i = 1; i < 9; i++) x += G7[i] / (z + i);
    var t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  // --- regularized incomplete beta I_x(a,b) (Numerical Recipes betai) -------
  function betacf(x, a, b) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function betacdf(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
    var bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta);
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
    return 1 - bt * betacf(1 - x, b, a) / b;
  }
  // Inverse CDF by bisection (deterministic; same in py).
  function betappf(p, a, b) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    var lo = 0, hi = 1, mid = 0.5;
    for (var i = 0; i < 100; i++) {
      mid = 0.5 * (lo + hi);
      if (betacdf(mid, a, b) < p) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function round4(x) {
    if (x === null || x === undefined || !isFinite(x)) return x;
    // match Python round(x,4) banker's rounding
    var neg = x < 0; if (neg) x = -x;
    var s = x.toFixed(12);
    var dot = s.indexOf("."), ip = s.slice(0, dot), fr = s.slice(dot + 1);
    var keep = fr.slice(0, 4).padEnd(4, "0"), rest = fr.slice(4);
    var scaled = BigInt(ip) * 10000n + BigInt(keep);
    var f = rest[0] || "0", up;
    if (f > "5") up = true; else if (f < "5") up = false;
    else { var tail = rest.slice(1).replace(/0+$/, ""); up = tail.length ? true : (scaled % 2n === 1n); }
    if (up) scaled += 1n;
    var out = Number(scaled) / 10000;
    return neg ? -out : out;
  }

  function overallRate(rows) {
    if (!rows.length) return 0.5;
    var done = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].done) done++;
    return done / rows.length;
  }

  function cellPosterior(done, n, m, k0) {
    return { alpha: m * k0 + done, beta: (1 - m) * k0 + (n - done) };
  }

  function betaBinomialCell(done, n, m, k0) {
    var ab = cellPosterior(done, n, m, k0);
    var mean = ab.alpha / (ab.alpha + ab.beta);
    var lo = betappf(CI_LO, ab.alpha, ab.beta);
    var hi = betappf(CI_HI, ab.alpha, ab.beta);
    return {
      n: n, done: done,
      raw_rate: n > 0 ? round4(done / n) : null,
      estimate: round4(mean),
      ci_low: round4(lo), ci_high: round4(hi),
      _alpha: ab.alpha, _beta: ab.beta
    };
  }

  // Beta pdf on a shared grid, normalized; convolve green and (−red) to get the
  // difference distribution deterministically. Grid is identical in py.
  function betaPdfGrid(a, b) {
    var lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
    var pdf = new Array(GRID + 1), sum = 0;
    for (var i = 0; i <= GRID; i++) {
      var x = i / GRID;
      var v;
      if (x <= 0 || x >= 1) v = (x <= 0 && a < 1) || (x >= 1 && b < 1) ? 0 : 0;
      else v = Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lbeta);
      pdf[i] = v; sum += v;
    }
    for (var j = 0; j <= GRID; j++) pdf[j] /= sum; // normalize to a pmf
    return pdf;
  }

  function differenceInterval(green, red) {
    var g = betaPdfGrid(green._alpha, green._beta);
    var r = betaPdfGrid(red._alpha, red._beta);
    // diff d = g_idx - r_idx in units of 1/GRID, range [-GRID, GRID].
    var diff = new Array(2 * GRID + 1).fill(0);
    for (var i = 0; i <= GRID; i++) {
      if (g[i] === 0) continue;
      for (var k = 0; k <= GRID; k++) {
        diff[i - k + GRID] += g[i] * r[k];
      }
    }
    // CDF over diff index; read quantiles + mean + P(diff>0).
    var cum = 0, lo = null, hi = null, meanAcc = 0, probPos = 0;
    for (var d = 0; d <= 2 * GRID; d++) {
      var val = (d - GRID) / GRID;
      meanAcc += val * diff[d];
      if (val > 0) probPos += diff[d];
      cum += diff[d];
      if (lo === null && cum >= CI_LO) lo = val;
      if (hi === null && cum >= CI_HI) hi = val;
    }
    if (lo === null) lo = -1;
    if (hi === null) hi = 1;
    return {
      diff_mean: round4(meanAcc),
      diff_ci_low: round4(lo),
      diff_ci_high: round4(hi),
      prob_green_higher: round4(probPos),
      drops: lo > 0
    };
  }

  function analyze(rows) {
    var m = overallRate(rows);
    // Keep the prior proper even at a 0% or 100% overall rate.
    if (m < PRIOR_MEAN_MIN) m = PRIOR_MEAN_MIN;
    else if (m > PRIOR_MEAN_MAX) m = PRIOR_MEAN_MAX;
    var typeSet = {};
    rows.forEach(function (r) { typeSet[r.type] = true; });
    var types = Object.keys(typeSet).sort();

    var cells = {};
    types.forEach(function (t) {
      cells[t] = {}; TIERS.forEach(function (tier) { cells[t][tier] = [0, 0]; });
    });
    rows.forEach(function (r) {
      var c = cells[r.type][r.tier]; c[1]++; if (r.done) c[0]++;
    });

    var resultTypes = {};
    types.forEach(function (t) {
      var perTier = {};
      TIERS.forEach(function (tier) {
        perTier[tier] = betaBinomialCell(cells[t][tier][0], cells[t][tier][1], m, PRIOR_STRENGTH);
      });
      var green = perTier.green, red = perTier.red, diff;
      if (green.n > 0 && red.n > 0) diff = differenceInterval(green, red);
      else diff = { diff_mean: null, diff_ci_low: null, diff_ci_high: null, prob_green_higher: null, drops: false };
      TIERS.forEach(function (tier) { delete perTier[tier]._alpha; delete perTier[tier]._beta; });
      resultTypes[t] = { tiers: perTier, green_minus_red: diff, drops_on_low: !!diff.drops };
    });

    return { overall_rate: round4(m), prior_strength: PRIOR_STRENGTH, ci_mass: CI_MASS, types: resultTypes };
  }

  function demotableTypes(analysis) {
    return Object.keys(analysis.types).filter(function (t) {
      return analysis.types[t].drops_on_low;
    });
  }

  // Build records {type, tier, done} from the app's localStorage check-in
  // history object (date -> [records]). Skips rows without a usable tier/done.
  function recordsFromHistory(history) {
    var out = [];
    Object.keys(history || {}).forEach(function (date) {
      var day = history[date];
      if (!Array.isArray(day)) return;
      day.forEach(function (r) {
        if (TIERS.indexOf(r.tier) !== -1 && typeof r.done === "boolean") {
          out.push({ type: r.type, tier: r.tier, done: r.done });
        }
      });
    });
    return out;
  }

  var api = {
    TIERS: TIERS, PRIOR_STRENGTH: PRIOR_STRENGTH, CI_MASS: CI_MASS, GRID: GRID,
    PRIOR_MEAN_MIN: PRIOR_MEAN_MIN, PRIOR_MEAN_MAX: PRIOR_MEAN_MAX,
    logGamma: logGamma, betacdf: betacdf, betappf: betappf, round4: round4,
    overallRate: overallRate, betaBinomialCell: betaBinomialCell,
    differenceInterval: differenceInterval, analyze: analyze,
    demotableTypes: demotableTypes, recordsFromHistory: recordsFromHistory
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HuifanPatternsCore = api;
})(typeof self !== "undefined" ? self : this);
