// app.js — UI wiring + localStorage history.
// Built up across tasks 2–5. Task 2: data source selection + recovery score.

(function () {
  "use strict";

  // Shared state. recoveryContext carries today's band + last night's sleep
  // into the reorder step. learnedDemotions stays empty until the patterns
  // page (task 6) proves a task type drops on low days.
  let recoveryContext = { sleepHours: null, band: null, learnedDemotions: [] };

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

    // Sleep hours are known even when the baseline score isn't ready, so the
    // short-sleep reorder rule can still fire.
    recoveryContext.sleepHours =
      typeof todayRow.sleep_h === "number" ? todayRow.sleep_h : null;

    if (!result.ok) {
      recoveryContext.band = null;
      section.innerHTML =
        badge +
        '<p class="score-learning">Still learning your baseline. ' +
        "Need a week of data first.</p>";
      return;
    }

    recoveryContext.band = result.band;

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

  // --- Task input + tagging (task 3) ----------------------------------
  //
  // State: the current list of tasks. Tasks are produced by the keyword
  // tagger, then the user may edit each task's type and effort. Later tasks
  // (reorder, check-in) will read and extend this same list.
  let tasks = [];

  function renderTasksSection() {
    const section = document.getElementById("tasks-section");
    if (!section) return;

    section.innerHTML =
      "<h2>Today's tasks</h2>" +
      '<p class="muted tasks-help">One task per line. We guess a type ' +
      "from keywords — change it if we got it wrong.</p>" +
      '<textarea id="task-input" class="task-input" rows="5" ' +
      'placeholder="write lab report&#10;read chapter 4&#10;' +
      'reply to emails&#10;gym&#10;coffee with Sam"></textarea>' +
      '<button id="tag-btn" class="btn">Tag tasks</button>' +
      '<ul id="task-list" class="task-list"></ul>' +
      '<button id="reorder-btn" class="btn btn--secondary">' +
      "Reorder for today</button>" +
      '<div id="reorder-result" class="reorder-result"></div>';

    const tagBtn = section.querySelector("#tag-btn");
    tagBtn.addEventListener("click", onTagClick);
    const reorderBtn = section.querySelector("#reorder-btn");
    reorderBtn.addEventListener("click", onReorderClick);

    renderTaskList();
  }

  function onReorderClick() {
    const target = document.getElementById("reorder-result");
    if (!target) return;
    if (tasks.length === 0) {
      target.innerHTML =
        '<p class="muted">Add and tag some tasks first.</p>';
      return;
    }
    const result = window.HuifanOrder.reorderTasks(tasks, recoveryContext);
    renderReordered(result, target);
  }

  function renderReordered(result, target) {
    const items = result.ordered
      .map(function (t) {
        const moved = t.movedBy
          ? '<span class="move-reason">' + escapeHtml(t.movedBy) + "</span>"
          : "";
        const chunk = t.chunk
          ? '<span class="chunk-hint">' + escapeHtml(t.chunk) + "</span>"
          : "";
        return (
          '<li class="ordered-item">' +
          '<span class="ordered-text">' +
          escapeHtml(t.text) +
          "</span>" +
          '<span class="ordered-tags">' +
          '<span class="pill">' +
          escapeHtml(t.type) +
          "</span>" +
          '<span class="pill">effort ' +
          t.effort +
          "</span>" +
          '<span class="pill">due ' +
          escapeHtml(t.due || "later") +
          "</span>" +
          "</span>" +
          moved +
          chunk +
          "</li>"
        );
      })
      .join("");

    target.innerHTML =
      '<h3 class="reorder-title">Your order for today</h3>' +
      '<p class="reorder-note muted">' +
      escapeHtml(result.notes) +
      "</p>" +
      '<ol class="ordered-list">' +
      items +
      "</ol>";
  }

  function onTagClick() {
    const input = document.getElementById("task-input");
    if (!input) return;
    tasks = window.HuifanTag.parseTasks(input.value);
    renderTaskList();
  }

  function renderTaskList() {
    const list = document.getElementById("task-list");
    if (!list) return;

    if (tasks.length === 0) {
      list.innerHTML =
        '<li class="muted task-empty">No tasks yet. ' +
        "Type some above and tag them.</li>";
      return;
    }

    const types = window.HuifanTag.TASK_TYPES;
    list.innerHTML = tasks
      .map(function (t, idx) {
        const options = types
          .map(function (ty) {
            const sel = ty === t.type ? " selected" : "";
            return '<option value="' + ty + '"' + sel + ">" + ty + "</option>";
          })
          .join("");
        const effortOptions = [1, 2, 3]
          .map(function (e) {
            const sel = e === t.effort ? " selected" : "";
            return '<option value="' + e + '"' + sel + ">" + e + "</option>";
          })
          .join("");
        const dues = ["today", "tomorrow", "later"];
        const dueOptions = dues
          .map(function (d) {
            const sel = d === (t.due || "later") ? " selected" : "";
            return '<option value="' + d + '"' + sel + ">" + d + "</option>";
          })
          .join("");
        return (
          '<li class="task-item">' +
          '<span class="task-text">' +
          escapeHtml(t.text) +
          "</span>" +
          '<span class="task-controls">' +
          '<select class="task-type" data-idx="' +
          idx +
          '" aria-label="Task type">' +
          options +
          "</select>" +
          '<select class="task-effort" data-idx="' +
          idx +
          '" aria-label="Effort 1 to 3">' +
          effortOptions +
          "</select>" +
          '<select class="task-due" data-idx="' +
          idx +
          '" aria-label="Due when">' +
          dueOptions +
          "</select>" +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    // Wire the editable dropdowns back into state.
    list.querySelectorAll(".task-type").forEach(function (sel) {
      sel.addEventListener("change", function (e) {
        const i = Number(e.target.getAttribute("data-idx"));
        if (tasks[i]) tasks[i].type = e.target.value;
      });
    });
    list.querySelectorAll(".task-effort").forEach(function (sel) {
      sel.addEventListener("change", function (e) {
        const i = Number(e.target.getAttribute("data-idx"));
        if (tasks[i]) tasks[i].effort = Number(e.target.value);
      });
    });
    list.querySelectorAll(".task-due").forEach(function (sel) {
      sel.addEventListener("change", function (e) {
        const i = Number(e.target.getAttribute("data-idx"));
        if (tasks[i]) tasks[i].due = e.target.value;
      });
    });
  }

  // --- Boot -----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    const { rows, source } = pickDataSource();
    renderScore(rows, source);
    renderTasksSection();
  });
})();
