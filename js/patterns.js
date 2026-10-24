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

  // ctx = { source: "real"|"sample"|"none", loggedDays: number }
  // For REAL data the committed patterns table is simulated, so we must NOT
  // present it as the user's own. We show the table as a labelled demo of the
  // method and tell the user their own patterns appear after enough logged
  // days (showing how many they have so far).
  function renderPatterns(mountId, ctx) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    ctx = ctx || {};
    const isReal = ctx.source === "real" || ctx.source === "local";
    const loggedDays = ctx.loggedDays || 0;
    const MIN_DAYS = ctx.minDays || 14;
    const own = ctx.ownAnalysis || null; // the user's OWN in-browser analysis

    const help =
      '<p class="muted patterns-help">How often each kind of task actually ' +
      "gets done, by recovery tier. Rates are shrunk toward the overall " +
      "rate when a cell is thin, so small samples don't overclaim.</p>";

    // REAL data with enough logged days: show the user's OWN table, computed
    // in the browser from their logs. Demotable types come from their result.
    if (isReal && own) {
      const demotable = own.types
        ? Object.keys(own.types).filter(function (t) { return own.types[t].drops_on_low; })
        : [];
      mount.innerHTML =
        "<h2>Patterns</h2>" +
        help +
        '<p class="data-badge data-badge--real">Your own logs — ' +
        loggedDays +
        " logged day" + (loggedDays === 1 ? "" : "s") +
        ", computed in your browser.</p>" +
        renderTable(own) +
        renderDemotable(demotable);
      return;
    }

    const data = window.HUIFAN_PATTERNS;

    // REAL data, not enough logged days yet: keep the honest demo message with
    // the day count; do NOT claim any type drops for this user.
    if (isReal) {
      const remaining = Math.max(0, MIN_DAYS - loggedDays);
      const banner =
        '<p class="sim-banner">This table is a <strong>demo of the method on ' +
        "simulated data</strong>, not your logs. Your own patterns appear once " +
        "you have enough logged days. So far you have logged <strong>" +
        loggedDays +
        " day" + (loggedDays === 1 ? "" : "s") + "</strong>" +
        (remaining > 0 ? " — about " + remaining + " more to go." : " — enough to start building your own view.") +
        "</p>";
      mount.innerHTML =
        "<h2>Patterns</h2>" + help + banner +
        (data ? renderTable(data.analysis) + renderRecoveryTest(data.recovery_test) : "") +
        '<p class="demotable muted">Your reorder keeps your own order until ' +
        "your own logs show a type reliably drops on low days.</p>";
      return;
    }

    // SAMPLE (or no source): the committed simulated demo, full loop.
    if (!data) {
      mount.innerHTML = "<h2>Patterns</h2>" + '<p class="muted">No patterns to show yet.</p>';
      return;
    }
    const banner = data.simulated
      ? '<p class="sim-banner">Simulated data — ' + data.n_records +
        " records with a planted pattern, used to demo and validate the method. Not real logs.</p>"
      : '<p class="data-badge data-badge--real">Your real logs (' + data.n_records + " records).</p>";
    mount.innerHTML =
      "<h2>Patterns</h2>" + help + banner +
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
