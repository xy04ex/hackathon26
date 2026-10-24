// app.js — UI wiring + localStorage history.
// Built up across tasks 2–5. Task 2: data source selection + recovery score.

(function () {
  "use strict";

  // Shared state. recoveryContext carries today's band + last night's sleep
  // into the reorder step. learnedDemotions stays empty until the patterns
  // page (task 6) proves a task type drops on low days.
  let recoveryContext = { sleepHours: null, band: null, learnedDemotions: [] };

  // The full recovery result for today (score, tier, composite z) so check-in
  // records can capture it. Set when the score renders.
  let todayScore = { date: null, score: null, tier: null, z: null };

  // The current reordered list being checked in (the display order).
  let orderedTasks = [];

  // --- localStorage history (wrapped so the app survives storage being off) --
  const STORAGE_KEY = "huifan.history.v1";

  function loadHistory() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {}; // storage unavailable or corrupt — degrade gracefully
    }
  }

  function saveHistory(history) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      return true;
    } catch (e) {
      return false; // private mode / disabled storage — app still works
    }
  }

  /**
   * Build one check-in record in the exact shape patterns.py will read.
   * done defaults to false until the user taps.
   */
  function buildRecord(task, done) {
    return {
      date: todayScore.date,
      task_text: task.text,
      type: task.type,
      effort: task.effort,
      due: task.due || "later",
      recovery_score: todayScore.score, // 0..100 or null
      tier: todayScore.tier, // green|yellow|red or null
      recovery_z: todayScore.z, // composite (pre-sigmoid) or null
      done: !!done,
    };
  }

  /** Persist today's records (array), keyed by date. Overwrites the day. */
  function saveTodayRecords(records) {
    const history = loadHistory();
    history[todayScore.date || "unknown"] = records;
    return saveHistory(history);
  }

  /** Flatten the whole history into one array for export / analysis. */
  function flattenHistory() {
    const history = loadHistory();
    const out = [];
    Object.keys(history)
      .sort()
      .forEach(function (date) {
        const day = history[date];
        if (Array.isArray(day)) out.push.apply(out, day);
      });
    return out;
  }

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
      // The single sample notice lives in the onboarding card (with the
      // "Use my own export" action), so we don't repeat a badge here.
      return "";
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
        '<p class="muted">Upload your Apple Health export, or keep the ' +
        "sample, to see a score.</p>";
      return;
    }

    const todayIndex = rows.length - 1;
    const todayRow = rows[todayIndex];
    const result = window.HuifanScore.computeRecovery(rows, todayIndex);

    // Sleep hours are known even when the baseline score isn't ready, so the
    // short-sleep reorder rule can still fire.
    recoveryContext.sleepHours =
      typeof todayRow.sleep_h === "number" ? todayRow.sleep_h : null;

    // Record today's date for check-in records regardless of score readiness.
    todayScore.date = todayRow.date;

    if (!result.ok) {
      recoveryContext.band = null;
      todayScore.score = null;
      todayScore.tier = null;
      todayScore.z = null;
      section.innerHTML =
        badge +
        '<p class="score-learning">Still learning your baseline. ' +
        "Need a week of data first.</p>";
      return;
    }

    recoveryContext.band = result.band;
    todayScore.score = result.score;
    todayScore.tier = result.band;
    todayScore.z = Math.round(result.composite * 10000) / 10000;

    // The pot IS the score: flame size = band, number on the pot, toppings =
    // today's tasks (coloured once done), steam = share of tasks done. We stash
    // what the pot needs and draw it; check-in toggles call drawPot() again.
    potState.scored = true;
    potState.score = result.score;
    potState.band = result.band;

    section.innerHTML =
      badge +
      '<div class="stove" id="pot-box"></div>' +
      '<div class="score-meta">' +
      '<p class="score-date muted">' +
      escapeHtml(todayRow.date) +
      "</p>" +
      '<p class="score-reason">' +
      escapeHtml(result.reason) +
      "</p>" +
      "</div>";
    drawPot();
  }

  // --- Pot visual (ported from Huifan v1; English labels) ----------------
  //
  // flame height = recovery band, score number on the pot, toppings = today's
  // tasks (coloured when done, raw/dashed when not), steam = share of tasks
  // done, lid on until a task list is in. All Chinese labels are translated.
  var potState = { scored: false, score: null, band: null };

  var SVGNS = "http://www.w3.org/2000/svg";
  // Band codes: g = green/High, m = yellow/Medium, r = red/Low heat.
  var HEAT = { green: "High heat", yellow: "Medium heat", red: "Low heat" };
  var BAND_CODE = { green: "g", yellow: "m", red: "r" };
  var FLAMES = { green: [7, 24], yellow: [5, 16], red: [3, 9] };
  var SPOTS = [[118, 72], [84, 89], [153, 83], [100, 79], [136, 75], [167, 91], [110, 91], [143, 92]];
  var ROWS = [[90, 57], [80.5, 46], [71.5, 32]];

  function sv(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  function spotsFor(n) {
    if (n <= SPOTS.length) return { r: 7, pts: SPOTS.slice(0, n) };
    var sizes = [5.5, 4.5], r = 0, caps = [], total = 0;
    for (var si = 0; si < sizes.length; si++) {
      r = sizes[si];
      caps = ROWS.map(function (row) { return Math.floor(2 * (row[1] - r - 2) / (2 * r + 2)) + 1; });
      total = caps[0] + caps[1] + caps[2];
      if (total >= n) break;
    }
    var m = Math.min(n, total), cnt = [0, 0, 0];
    for (var k = 0; k < m; k++) {
      var best = -1, bestFill = 2;
      for (var i = 0; i < 3; i++) {
        var fill = (cnt[i] + 1) / caps[i];
        if (cnt[i] < caps[i] && fill < bestFill) { best = i; bestFill = fill; }
      }
      cnt[best]++;
    }
    var pts = [];
    ROWS.forEach(function (row, i) {
      for (var j = 0; j < cnt[i]; j++) pts.push([120 + (j - (cnt[i] - 1) / 2) * (2 * r + 2), row[0]]);
    });
    return { r: r, pts: pts };
  }

  // The tasks the pot shows: the reordered check-in list if present, else the
  // tagged tasks. done-state comes from orderedTasks when available.
  function potTasks() {
    if (orderedTasks && orderedTasks.length) {
      return orderedTasks.map(function (t) { return { done: !!t.done }; });
    }
    return (tasks || []).map(function () { return { done: false }; });
  }

  function drawPot() {
    var box = document.getElementById("pot-box");
    if (!box) return;
    box.innerHTML = "";

    var scored = potState.scored;
    var band = scored ? potState.band : null;
    var code = band ? BAND_CODE[band] : null;
    var ts = potTasks();
    var doneN = ts.filter(function (t) { return t.done; }).length;
    var open = ts.length > 0;

    // Accessible, English description of the whole picture.
    var label = (scored ? HEAT[band] + ", recovery " + potState.score : open ? "not lit yet" : "nothing cooking yet") +
      (open ? "; " + ts.length + " task" + (ts.length === 1 ? "" : "s") + " in the pot, " + doneN + " done" : "");
    var svg = sv("svg", { viewBox: "18 0 244 212", role: "img", "aria-label": label }, box);

    // steam = share of tasks done
    var wisps = open && doneN ? Math.max(1, Math.round(doneN / ts.length * 3)) : 0;
    [100, 122, 144].slice(0, wisps).forEach(function (x, i) {
      var pth = sv("path", { "class": "st", d: "M" + x + " 50 q-7 -8 0 -16 q7 -8 0 -16" }, svg);
      pth.style.animationDelay = (i * 0.9) + "s";
    });

    // rice + toppings (tasks), visible once the lid is off
    if (open) {
      sv("path", { "class": "pot-rice", d: "M56 97 Q120 30 184 97 Z" }, svg);
      var lay = spotsFor(ts.length), tr = lay.r, tw = tr * 15 / 7, th = tr * 11 / 7;
      ts.slice(0, lay.pts.length).forEach(function (t, i) {
        var pp = lay.pts[i], cls = "top " + (t.done ? "f" + (i % 5 + 1) : "raw");
        if (i % 2) sv("rect", { "class": cls, x: pp[0] - tw / 2, y: pp[1] - th / 2, width: tw, height: th, rx: tr / 2, transform: "rotate(" + (i * 23 - 30) + " " + pp[0] + " " + pp[1] + ")" }, svg);
        else sv("circle", { "class": cls, cx: pp[0], cy: pp[1], r: tr }, svg);
      });
    }

    // pot body
    sv("rect", { "class": "pot-rim", x: 26, y: 112, width: 30, height: 13, rx: 6.5 }, svg);
    sv("rect", { "class": "pot-rim", x: 184, y: 112, width: 30, height: 13, rx: 6.5 }, svg);
    sv("path", { "class": "pot-body", d: "M52 104 L188 104 Q189 160 162 169 L78 169 Q51 160 52 104 Z" }, svg);
    sv("rect", { "class": "pot-rim", x: 44, y: 94, width: 152, height: 13, rx: 6.5 }, svg);
    [[66, 122], [74, 148], [92, 160], [168, 118], [174, 142], [154, 158], [84, 116], [160, 128], [108, 162], [140, 114]].forEach(function (pp, i) {
      sv("circle", { "class": "pot-spk", cx: pp[0], cy: pp[1], r: i % 3 ? 1.3 : 2 }, svg);
    });
    if (scored) {
      var num = sv("text", { "class": "pot-num", x: 120, y: 151, "text-anchor": "middle" }, svg);
      num.textContent = String(potState.score);
    }

    // lid: on the pot until the list is in, then leaning against it
    var lid = sv("g", { transform: open ? "translate(236 140) rotate(76) scale(.9)" : "translate(120 82)" }, svg);
    sv("path", { "class": "pot-rim", d: "M-68 13 Q-64 -12 0 -14 Q64 -12 68 13 Z" }, lid);
    sv("rect", { "class": "pot-body", x: -11, y: -25, width: 22, height: 12, rx: 6 }, lid);

    // stove + flame (flame size = band)
    sv("rect", { "class": "stove-bar", x: 66, y: 169, width: 6, height: 29 }, svg);
    sv("rect", { "class": "stove-bar", x: 168, y: 169, width: 6, height: 29 }, svg);
    sv("rect", { "class": "stove-bar", x: 40, y: 197, width: 216, height: 8, rx: 4 }, svg);
    if (scored) {
      var n = FLAMES[band][0], h = FLAMES[band][1];
      for (var i = 0; i < n; i++) {
        var x = 120 + (i - (n - 1) / 2) * 13;
        var hh = h * (i % 2 ? 0.8 : 1);
        var g = sv("g", { "class": "fl" }, svg);
        g.style.animationDelay = (-i * 0.23) + "s";
        sv("path", { "class": "fl-o", d: "M" + (x - 5.5) + " 197 Q" + (x - 7) + " " + (197 - hh * 0.5) + " " + x + " " + (197 - hh) + " Q" + (x + 7) + " " + (197 - hh * 0.5) + " " + (x + 5.5) + " 197 Z" }, g);
        sv("path", { "class": "fl-i", d: "M" + (x - 2.5) + " 197 Q" + (x - 3.5) + " " + (197 - hh * 0.3) + " " + x + " " + (197 - hh * 0.55) + " Q" + (x + 3.5) + " " + (197 - hh * 0.3) + " " + (x + 2.5) + " 197 Z" }, g);
      }
    }

    // caption chip (English)
    var cap = document.createElement("div");
    cap.className = "heat";
    var chip = document.createElement("span");
    chip.className = "heat-chip" + (code ? " " + code : "");
    chip.textContent = scored ? HEAT[band] : open ? "not lit yet" : "nothing cooking yet";
    cap.appendChild(chip);
    if (open) {
      var n2 = document.createElement("span");
      n2.className = "heat-n";
      n2.textContent = doneN === ts.length ? "all done — serve it up" : ts.length + " in the pot · " + doneN + " done";
      cap.appendChild(n2);
    }
    box.appendChild(cap);
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
    // Keep the display order as the check-in list. Carry over any done-state
    // already saved for today so a reload doesn't lose taps.
    const savedToday = loadHistory()[todayScore.date] || [];
    const doneByText = {};
    savedToday.forEach(function (r) {
      doneByText[r.task_text] = r.done;
    });

    orderedTasks = result.ordered.map(function (t) {
      return Object.assign({}, t, {
        done: doneByText[t.text] === true,
      });
    });

    target.innerHTML =
      '<h3 class="reorder-title">Your order for today</h3>' +
      '<p class="reorder-note muted">' +
      escapeHtml(result.notes) +
      "</p>" +
      '<p class="checkin-hint muted">Tap a task to mark it done. ' +
      "Saved automatically.</p>" +
      '<ol id="checkin-list" class="ordered-list"></ol>' +
      '<button id="export-btn" class="btn btn--secondary">' +
      "Export history (JSON)</button>";

    renderCheckinList();

    const exportBtn = document.getElementById("export-btn");
    if (exportBtn) exportBtn.addEventListener("click", onExportClick);

    // Persist today's list immediately so a record exists even before taps.
    persistToday();
    drawPot();
  }

  function renderCheckinList() {
    const list = document.getElementById("checkin-list");
    if (!list) return;

    list.innerHTML = orderedTasks
      .map(function (t, idx) {
        const moved = t.movedBy
          ? '<span class="move-reason">' + escapeHtml(t.movedBy) + "</span>"
          : "";
        const chunk = t.chunk
          ? '<span class="chunk-hint">' + escapeHtml(t.chunk) + "</span>"
          : "";
        const doneClass = t.done ? " ordered-item--done" : "";
        const check = t.done ? "✓" : "○";
        return (
          '<li class="ordered-item checkin-item' +
          doneClass +
          '" data-idx="' +
          idx +
          '" role="button" tabindex="0" ' +
          'aria-pressed="' +
          (t.done ? "true" : "false") +
          '">' +
          '<span class="checkbox">' +
          check +
          "</span>" +
          '<span class="ordered-main">' +
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
          "</span>" +
          "</li>"
        );
      })
      .join("");

    // One tap toggles done. Keyboard (Enter/Space) works too for a11y.
    list.querySelectorAll(".checkin-item").forEach(function (li) {
      li.addEventListener("click", function () {
        toggleDone(Number(li.getAttribute("data-idx")));
      });
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleDone(Number(li.getAttribute("data-idx")));
        }
      });
    });
  }

  function toggleDone(idx) {
    if (!orderedTasks[idx]) return;
    orderedTasks[idx].done = !orderedTasks[idx].done;
    persistToday();
    renderCheckinList();
    drawPot();
  }

  function persistToday() {
    const records = orderedTasks.map(function (t) {
      return buildRecord(t, t.done);
    });
    saveTodayRecords(records);
  }

  function onExportClick() {
    const all = flattenHistory();
    const blob = new Blob([JSON.stringify(all, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "huifan-history.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function onTagClick() {
    const input = document.getElementById("task-input");
    if (!input) return;
    tasks = window.HuifanTag.parseTasks(input.value);
    renderTaskList();
    drawPot();
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

  // Count the days the user has logged a check-in (one key per date with
  // records). Used to tell a real user how close they are to their own
  // pattern analysis.
  function loggedDayCount() {
    const history = loadHistory();
    return Object.keys(history).filter(function (d) {
      return Array.isArray(history[d]) && history[d].length > 0;
    }).length;
  }

  // Which task types the reorder may move later on low-recovery days.
  //
  // IMPORTANT: window.HUIFAN_PATTERNS.demotable_types comes from SIMULATED
  // logs (scripts/patterns.py on data/simulated-logs.json). Applying it to a
  // real user would move, say, their deep work later because of fake data.
  // So we only use the simulated demotions when the SAMPLE dataset is active
  // (demo). For uploaded or local real data, demotions must come from the
  // user's OWN logged history — and until in-browser per-user pattern
  // analysis exists, that is empty. Empty is the safe default: the reorder
  // keeps the user's order.
  function loadLearnedDemotions(source) {
    const p = window.HUIFAN_PATTERNS;
    const isSimulatedDemo =
      source === "sample" && p && p.simulated === true && Array.isArray(p.demotable_types);
    if (isSimulatedDemo) {
      return p.demotable_types.slice();
    }
    return [];
  }

  // --- Boot -----------------------------------------------------------
  //
  // render() is the whole-page render. It is exposed as window.HuifanApp.render
  // so onboarding (js/onboarding.js) can re-render after a successful parse,
  // after "Delete my data", or when showing sample data, without a full reload.
  function render() {
    const { rows, source } = pickDataSource();
    recoveryContext.learnedDemotions = loadLearnedDemotions(source);
    renderScore(rows, source);
    renderTasksSection();
    if (window.HuifanPatterns) {
      // Real data (uploaded/local) must not present the simulated table as the
      // user's own. Tell the renderer the data context + how many days they
      // have logged so far.
      window.HuifanPatterns.renderPatterns("patterns-section", {
        source: source,
        loggedDays: loggedDayCount(),
      });
    }
    if (window.HuifanInsights) {
      window.HuifanInsights.renderInsights("insights-section");
    }
  }

  window.HuifanApp = { render: render };

  document.addEventListener("DOMContentLoaded", function () {
    // Mount onboarding first: it hydrates window.HUIFAN_DAILY from localStorage
    // (when present) and shows the first-run screen only when there is no data.
    if (window.HuifanOnboarding) {
      window.HuifanOnboarding.mount("onboarding-section");
    }
    render();
  });
})();
