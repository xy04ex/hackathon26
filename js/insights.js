// insights.js — render the sleep -> next-morning HRV insights (NO math here).
//
// All statistics are computed offline by scripts/insights.py and loaded as
// window.HUIFAN_INSIGHTS (aggregates only — no raw daily values). This file
// turns that JSON into HTML.

(function () {
  "use strict";

  function renderInsights(mountId) {
    const mount = document.getElementById(mountId);
    if (!mount) return;

    const d = window.HUIFAN_INSIGHTS;
    if (!d) {
      mount.innerHTML =
        "<h2>Insights</h2>" +
        '<p class="muted">No insights yet. Run ' +
        "<code>scripts/insights.py</code> on your data to generate them.</p>";
      return;
    }

    mount.innerHTML =
      "<h2>Insights</h2>" +
      renderPairs(d) +
      renderDevice(d.device_change, d.analysis_window) +
      renderRegression(d.primary) +
      renderCdc(d.cdc_context) +
      '<p class="insights-note muted">' +
      escapeHtml(d.note || "") +
      "</p>";
  }

  function renderPairs(d) {
    const p = d.primary || {};
    const window =
      d.analysis_window === "recent_segment"
        ? "the most recent consistent period"
        : "your full history";
    const span =
      p.date_from && p.date_to
        ? " (" + p.date_from + " to " + p.date_to + ")"
        : "";
    return (
      '<p class="insights-lead">Linking each night\u2019s sleep to the next ' +
      "morning\u2019s HRV across " +
      window +
      span +
      ": <strong>" +
      (p.n_pairs || d.n_pairs_total || 0) +
      " paired days</strong>.</p>"
    );
  }

  function renderDevice(dev, windowUsed) {
    if (!dev) return "";
    if (!dev.changed) {
      return (
        '<p class="device-note muted">No sudden shift in your HRV baseline ' +
        "was detected, so the analysis uses your full HRV history.</p>"
      );
    }
    const segs = (dev.segments || [])
      .map(function (s) {
        return (
          "<li>" +
          s.from +
          " \u2013 " +
          s.to +
          ": mean HRV " +
          s.mean_hrv +
          " ms (" +
          s.n +
          " days)</li>"
        );
      })
      .join("");
    return (
      '<div class="device-change">' +
      '<p>A step change in your HRV baseline was detected around <strong>' +
      escapeHtml(dev.boundary_date) +
      "</strong> (" +
      dev.step_sd_units +
      " SD shift), which usually means a device change. " +
      "To keep things comparable, the numbers below use " +
      (windowUsed === "recent_segment"
        ? "only the most recent period."
        : "the full history.") +
      "</p><ul class=\"device-segments\">" +
      segs +
      "</ul></div>"
    );
  }

  function renderRegression(p) {
    if (!p || !p.enough) {
      return (
        '<p class="muted">Not enough paired days yet for a reliable ' +
        "sleep\u2013HRV estimate.</p>"
      );
    }
    const dir = p.slope_ms_per_hour >= 0 ? "higher" : "lower";
    const excludes = p.slope_excludes_zero
      ? "The 95% interval excludes zero, so this small effect looks real."
      : "The 95% interval includes zero, so treat this as suggestive only.";
    return (
      '<div class="regression">' +
      '<p class="stat-line">Correlation (sleep vs next-day HRV): ' +
      "<strong>r = " +
      p.pearson_r +
      "</strong></p>" +
      '<p class="stat-line">Each extra hour of sleep is associated with ' +
      "<strong>" +
      Math.abs(p.slope_ms_per_hour) +
      " ms " +
      dir +
      "</strong> HRV the next morning " +
      '<span class="ci">(95% CI ' +
      p.slope_ci_low +
      " to " +
      p.slope_ci_high +
      " ms/h)</span>.</p>" +
      '<p class="stat-caveat muted">' +
      excludes +
      "</p>" +
      "</div>"
    );
  }

  function renderCdc(c) {
    if (!c) return "";
    return (
      '<div class="cdc-context">' +
      "<p>For context, about <strong>" +
      c.pct_short_sleep +
      "%</strong> of adults in " +
      escapeHtml(c.county) +
      " County regularly sleep under 7 hours" +
      (c.ci_low != null
        ? " (" + c.ci_low + "\u2013" + c.ci_high + "%)"
        : "") +
      (c.year ? ", " + c.year : "") +
      ".</p>" +
      '<p class="cdc-cite muted">Source: ' +
      escapeHtml(c.citation || "CDC PLACES") +
      "</p>" +
      "</div>"
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  if (typeof window !== "undefined") {
    window.HuifanInsights = { renderInsights };
  }
})();
