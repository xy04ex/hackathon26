// patterns.js — render the Beta-Binomial patterns results (NO math here).
//
// All statistics are computed offline by scripts/patterns.py and loaded as
// window.HUIFAN_PATTERNS. This file only turns that JSON into HTML. When the
// data is simulated, we label it clearly so no one mistakes it for real logs.

(function () {
  "use strict";

  const TIERS = ["green", "yellow", "red"];

  function pct(x) {
    return x === null || x === undefined ? "—" : Math.round(x * 100) + "%";
  }

  function renderPatterns(mountId) {
    const mount = document.getElementById(mountId);
    if (!mount) return;

    const data = window.HUIFAN_PATTERNS;
    if (!data) {
      mount.innerHTML =
        '<p class="muted">No patterns yet. Run ' +
        "<code>scripts/patterns.py</code> to generate them.</p>";
      return;
    }

    const simBanner = data.simulated
      ? '<p class="sim-banner">Simulated data — ' +
        data.n_records +
        " records with a planted pattern, used to demo and validate the " +
        "method. Not your real logs.</p>"
      : '<p class="data-badge data-badge--real">Your real logs (' +
        data.n_records +
        " records).</p>";

    mount.innerHTML =
      "<h2>Patterns</h2>" +
      '<p class="muted patterns-help">How often each kind of task actually ' +
      "gets done, by recovery tier. Rates are shrunk toward your overall " +
      "rate (" +
      pct(data.analysis.overall_rate) +
      ") when a cell is thin, so small samples don't overclaim.</p>" +
      simBanner +
      renderTable(data.analysis) +
      renderRecoveryTest(data.recovery_test) +
      renderDemotable(data.demotable_types);
  }

  function renderTable(analysis) {
    const types = Object.keys(analysis.types).sort();
    const head =
      "<tr><th>Task type</th>" +
      TIERS.map(function (t) {
        return '<th class="tier-' + t + '">' + t + "</th>";
      }).join("") +
      "<th>green − red</th></tr>";

    const body = types
      .map(function (type) {
        const info = analysis.types[type];
        const cells = TIERS.map(function (tier) {
          const c = info.tiers[tier];
          const est = pct(c.estimate);
          const ci =
            c.n > 0
              ? '<span class="ci">' +
                pct(c.ci_low) +
                "–" +
                pct(c.ci_high) +
                " · n=" +
                c.n +
                "</span>"
              : '<span class="ci muted">no data</span>';
          return "<td>" + est + "<br>" + ci + "</td>";
        }).join("");

        const diff = info.green_minus_red;
        const diffStr =
          diff.diff_mean === null
            ? "—"
            : (diff.diff_mean > 0 ? "+" : "") +
              Math.round(diff.diff_mean * 100) +
              "pp";
        const flag = info.drops_on_low
          ? '<span class="drop-flag">drops on low days</span>'
          : "";
        return (
          "<tr><th>" +
          type +
          "</th>" +
          cells +
          '<td class="diff-cell">' +
          diffStr +
          " " +
          flag +
          "</td></tr>"
        );
      })
      .join("");

    return (
      '<div class="table-wrap"><table class="patterns-table">' +
      "<thead>" +
      head +
      "</thead><tbody>" +
      body +
      "</tbody></table></div>"
    );
  }

  function renderRecoveryTest(test) {
    if (!test) return "";
    const status = test.all_pass ? "pass" : "fail";
    const checks = test.checks
      .map(function (c) {
        const mark = c.pass ? "✓" : "✗";
        return (
          '<li class="check-' +
          (c.pass ? "pass" : "fail") +
          '">' +
          mark +
          " " +
          c.name +
          "</li>"
        );
      })
      .join("");
    return (
      '<div class="recovery-test recovery-test--' +
      status +
      '">' +
      "<h3>Recovery test</h3>" +
      '<p class="muted">Because the simulated data has a known planted ' +
      "pattern, we check the method finds it.</p>" +
      "<ul>" +
      checks +
      "</ul></div>"
    );
  }

  function renderDemotable(types) {
    if (!types || types.length === 0) {
      return (
        '<p class="demotable muted">No task type has enough evidence yet to ' +
        "move it later on low days. The reorder keeps your order until it does.</p>"
      );
    }
    return (
      '<p class="demotable">Proven to drop on low-recovery days: ' +
      '<strong>' +
      types.join(", ") +
      "</strong>. On red days the reorder moves these later.</p>"
    );
  }

  if (typeof window !== "undefined") {
    window.HuifanPatterns = { renderPatterns };
  }
})();
