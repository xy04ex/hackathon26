// app.js — UI wiring + localStorage history.
// Built up across tasks 2–5. Task 2: data source selection + recovery score.

(function () {
  "use strict";

  // --- Data source selection ------------------------------------------
  //
  // Prefer the user's real data (window.HUIFAN_DAILY, written by the parser).
  // Fall back to the committed synthetic sample. Report which one is live so
  // the demo is honest about showing sample data.
  function pickDataSource() {
    const real = window.HUIFAN_DAILY;
    if (Array.isArray(real) && real.length > 0) {
      return { rows: real, source: "real" };
    }
    const sample = window.HUIFAN_SAMPLE_DAILY;
    if (Array.isArray(sample) && sample.length > 0) {
      return { rows: sample, source: "sample" };
    }
    return { rows: [], source: "none" };
  }

  // --- Rendering ------------------------------------------------------

  function renderDataBadge(source) {
    if (source === "real") {
      return (
        '<p class="data-badge data-badge--real">Using your data ' +
        "(data/daily.js)</p>"
      );
    }
    if (source === "sample") {
      return (
        '<p class="data-badge data-badge--sample">Sample data — ' +
        "synthetic, for the demo. Run the parser to use your own.</p>"
      );
    }
    return '<p class="data-badge data-badge--sample">No data loaded.</p>';
  }

  function renderScore(rows, source) {
    const section = document.getElementById("score-section");
    if (!section) return;

    const badge = renderDataBadge(source);

    if (rows.length === 0) {
      section.innerHTML =
        badge +
        '<p class="muted">Add data/daily.js (run the parser) or keep the ' +
        "sample to see a score.</p>";
      return;
    }

    const todayIndex = rows.length - 1;
    const todayRow = rows[todayIndex];
    const result = window.HuifanScore.computeRecovery(rows, todayIndex);

    if (!result.ok) {
      section.innerHTML =
        badge +
        '<p class="score-learning">Still learning your baseline. ' +
        "Need a week of data first.</p>";
      return;
    }

    section.innerHTML =
      badge +
      '<div class="score-row">' +
      '<div class="score-dial score-dial--' +
      result.band +
      '">' +
      '<span class="score-number">' +
      result.score +
      "</span>" +
      '<span class="score-band">' +
      result.band +
      "</span>" +
      "</div>" +
      '<div class="score-meta">' +
      '<p class="score-date muted">' +
      todayRow.date +
      "</p>" +
      '<p class="score-reason">' +
      escapeHtml(result.reason) +
      "</p>" +
      "</div>" +
      "</div>";
  }

  // Small escape so a date/reason string can never inject markup.
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // --- Boot -----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    const { rows, source } = pickDataSource();
    renderScore(rows, source);
  });
})();
