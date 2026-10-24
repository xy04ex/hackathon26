// insights.js — render per-user insights. Computes in the browser via
// js/insights-core.js on the ACTIVE dataset (uploaded real data, local
// daily.js, or sample). It no longer reads a committed personal insights.json.

(function () {
  "use strict";

  // Active dataset: prefer real data, else the sample (mirrors app.js
  // pickDataSource). We compute insights from whichever is loaded, so each
  // user sees THEIR results.
  function activeRows() {
    var real = window.HUIFAN_DAILY;
    if (Array.isArray(real) && real.length > 0) return { rows: real, source: "real" };
    var sample = window.HUIFAN_SAMPLE_DAILY;
    if (Array.isArray(sample) && sample.length > 0) return { rows: sample, source: "sample" };
    return { rows: [], source: "none" };
  }

  // CDC Suffolk passthrough for the reference block (read from the committed
  // CDC file if present on window, else null).
  function cdcSuffolk() {
    var cdc = window.HUIFAN_CDC;
    if (!cdc || !Array.isArray(cdc.counties)) return null;
    var s = cdc.counties.filter(function (c) { return c.county === "Suffolk"; })[0];
    if (!s) return null;
    return {
      county: "Suffolk", pct_short_sleep: s.pct_short_sleep,
      ci_low: s.ci_low, ci_high: s.ci_high, year: s.year, citation: cdc.citation,
    };
  }

  function renderInsights(mountId) {
    var mount = document.getElementById(mountId);
    if (!mount) return;
    var core = window.HuifanInsightsCore;
    var picked = activeRows();

    if (!core || picked.rows.length === 0) {
      mount.innerHTML = collapsibleCard(
        "Insights",
        "Load your data or try the sample to see your insights.",
        '<p class="muted">Load your data (or try the sample) to see insights ' +
          "computed right here in your browser.</p>"
      );
      return;
    }

    var d = core.computeInsights(picked.rows, { seed: core.SEED, cdc: cdcSuffolk() });

    var body =
      renderSlope(d) +
      renderSleepDebt(d.sleep_debt) +
      renderReference(d.reference) +
      '<p class="insights-note muted">' + esc(d.note) + "</p>";
    mount.innerHTML = collapsibleCard("Insights", insightsTakeaway(d), body);
  }

  // One-sentence takeaway for the collapsed summary, from the slope result.
  function insightsTakeaway(d) {
    var p = d.primary || {};
    if (!p.enough) return "Keep logging to see how sleep relates to your HRV.";
    if (p.slope_excludes_zero) {
      var dir = p.slope_ms_per_hour >= 0 ? "lifts" : "lowers";
      return "More sleep " + dir + " your next-morning HRV.";
    }
    return "Last night\u2019s sleep barely predicts your next-morning HRV.";
  }

  // Collapsed, keyboard-accessible disclosure card with a summary takeaway.
  function collapsibleCard(title, takeaway, bodyHtml) {
    return (
      '<details class="card-collapse">' +
      '<summary class="card-summary">' +
      '<span class="card-summary-title">' + esc(title) + "</span>" +
      '<span class="card-summary-take">' + esc(takeaway) + "</span>" +
      "</summary>" +
      '<div class="card-body">' + bodyHtml + "</div>" +
      "</details>"
    );
  }

  function renderSlope(d) {
    var p = d.primary || {};
    if (!p.enough) {
      return '<p class="muted">Not enough paired days yet for a reliable ' +
        "sleep\u2013HRV estimate. Keep logging and check back.</p>";
    }
    var dir = p.slope_ms_per_hour >= 0 ? "higher" : "lower";
    var verdict = p.slope_excludes_zero
      ? "The 95% interval excludes zero, so this small effect looks real."
      : "The 95% interval includes zero, so treat this as suggestive only.";
    return (
      '<p class="insights-lead">Linking each night\u2019s sleep to the next ' +
      "morning\u2019s <strong>baseline-adjusted</strong> HRV across <strong>" +
      p.n_pairs + " paired days</strong> (" + esc(p.date_from) + " to " +
      esc(p.date_to) + ").</p>" +
      '<p class="stat-line">Correlation: <strong>r = ' + p.pearson_r + "</strong></p>" +
      '<p class="stat-line">Each extra hour of sleep is associated with <strong>' +
      Math.abs(p.slope_ms_per_hour) + " ms " + dir + "</strong> baseline-adjusted " +
      'HRV the next morning <span class="ci">(95% CI ' + p.slope_ci_low + " to " +
      p.slope_ci_high + " ms/h)</span>.</p>" +
      '<p class="stat-caveat muted">' + verdict + "</p>"
    );
  }

  function renderSleepDebt(sd) {
    if (!sd || !sd.enough) {
      return '<p class="muted">Not enough paired days yet to compare ' +
        "last night vs. recent sleep debt.</p>";
    }
    var sentence;
    if (sd.verdict === "negligible") {
      sentence = "For you, last night\u2019s sleep and your last-3-nights total " +
        "predict next-morning HRV about equally well (the difference is negligible).";
    } else if (sd.verdict === "last_night") {
      sentence = "For you, <strong>last night\u2019s sleep</strong> predicts " +
        "next-morning HRV a little better than your last-3-nights total.";
    } else {
      sentence = "For you, your <strong>last-3-nights total sleep</strong> predicts " +
        "next-morning HRV a little better than last night alone.";
    }
    return (
      '<div class="sleep-debt">' +
      "<p>" + sentence + "</p>" +
      '<p class="stat-caveat muted">Out-of-sample RMSE (time-ordered 5-fold CV): ' +
      "last-night " + sd.rmse_last_night + " ms, last-3-nights " +
      sd.rmse_sleep_debt + " ms.</p></div>"
    );
  }

  function renderReference(ref) {
    if (!ref) return "";
    var parts = ['<div class="reference-context"><h3>For context</h3>'];
    if (ref.short_sleep) {
      var pct = Math.round(ref.short_sleep.share * 100);
      parts.push(
        "<p>You slept under " + ref.recommended_sleep_h + " h on <strong>" +
        pct + "%</strong> of your " + ref.short_sleep.n_nights +
        " tracked nights. Adults are generally advised to get " +
        ref.recommended_sleep_h + "+ hours (CDC/AASM)."
      );
      if (ref.cdc_context) {
        parts.push(
          " For comparison, about <strong>" + ref.cdc_context.pct_short_sleep +
          "%</strong> of adults in " + esc(ref.cdc_context.county) +
          " County regularly sleep under 7 h" +
          (ref.cdc_context.year ? ", " + ref.cdc_context.year : "") + "."
        );
      }
      parts.push("</p>");
    }
    if (ref.resting_hr) {
      parts.push(
        "<p>Your resting heart rate averages <strong>" + ref.resting_hr.mean_rhr +
        " bpm</strong>. The general adult range is " + ref.resting_hr.adult_range_low +
        "\u2013" + ref.resting_hr.adult_range_high + " bpm, shown only as context " +
        "(not a judgement or diagnosis).</p>"
      );
    }
    // HRV is deliberately NOT compared to any population norm.
    parts.push('<p class="muted">' + esc(ref.hrv_note) + "</p>");
    if (ref.cdc_context && ref.cdc_context.citation) {
      parts.push('<p class="cdc-cite muted">Source: ' + esc(ref.cdc_context.citation) + "</p>");
    }
    parts.push("</div>");
    return parts.join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  if (typeof window !== "undefined") {
    window.HuifanInsights = { renderInsights: renderInsights };
  }
})();
