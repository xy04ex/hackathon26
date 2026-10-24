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
  function buildRecord(task) {
    const status = task.status || "pending"; // pending | done | skipped
    return {
      date: todayScore.date,
      task_text: task.text,
      type: task.type,
      effort: task.effort,
      due: task.due || "later",
      recovery_score: todayScore.score, // 0..100 or null
      tier: todayScore.tier, // green|yellow|red or null
      recovery_z: todayScore.z, // composite (pre-sigmoid) or null
      status: status,
      skipped: status === "skipped",
      // `done` kept for older readers; a skipped task is NOT done and must not
      // be counted as not-done either (patterns-core excludes skipped rows).
      done: status === "done",
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
  var potState = { scored: false, score: null, band: null, celebrated: false };

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

  // The tasks the pot shows: today's tasks that are not skipped. A task is
  // "done" when its status is "done".
  function potTasks() {
    return (tasks || [])
      .filter(function (t) { return t.status !== "skipped"; })
      .map(function (t) { return { done: t.status === "done" }; });
  }

  // Band-specific message shown under the finished bowl.
  var DONE_MESSAGE = {
    red: "All done on a low-recovery day. Go easy tonight.",
    yellow: "All done. Rest is part of the plan.",
    green: "All done. Good day to bank some recovery.",
  };

  // Index of a topping that was just ticked, so drawPot can pop it with a
  // bounce exactly once. Cleared after the next draw.
  var popToppingIndex = null;

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
    var allDone = open && doneN === ts.length;

    if (allDone) {
      drawBowl(box, ts, band);
      popToppingIndex = null;
      return;
    }

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
        if (t.done && popToppingIndex === i) cls += " top-pop";
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
      n2.textContent = ts.length + " in the pot \u00B7 " + doneN + " done";
      cap.appendChild(n2);
    }
    box.appendChild(cap);
    popToppingIndex = null;
  }

  // The finished state: the pot has lifted off the stove and become a bowl.
  // Same rice, ONE coloured topping per completed task, steam rising, no stove
  // or flame. Message under the bowl depends on today's recovery band.
  function drawBowl(box, ts, band) {
    var n = ts.length;
    var label = "All " + n + " task" + (n === 1 ? "" : "s") +
      " done — served up as a bowl" + (band ? " (" + HEAT[band] + " recovery day)" : "") + ".";
    var svg = sv("svg", { viewBox: "18 0 244 212", role: "img", "aria-label": label, "class": "bowl-svg" }, box);

    // steam always rising over a finished bowl
    [100, 122, 144].forEach(function (x, i) {
      var pth = sv("path", { "class": "st", d: "M" + x + " 44 q-7 -8 0 -16 q7 -8 0 -16" }, svg);
      pth.style.animationDelay = (i * 0.8) + "s";
    });

    // rice mound
    sv("path", { "class": "pot-rice", d: "M58 112 Q120 44 182 112 Z" }, svg);

    // one coloured topping per completed task (uses the same spot layout)
    var lay = spotsFor(n), tr = lay.r, tw = tr * 15 / 7, th = tr * 11 / 7;
    ts.slice(0, lay.pts.length).forEach(function (t, i) {
      var pp = lay.pts[i], dy = 15; // toppings sit a touch lower on the mound
      var cls = "top f" + (i % 5 + 1);
      if (i % 2) sv("rect", { "class": cls, x: pp[0] - tw / 2, y: pp[1] - th / 2 + dy, width: tw, height: th, rx: tr / 2, transform: "rotate(" + (i * 23 - 30) + " " + pp[0] + " " + (pp[1] + dy) + ")" }, svg);
      else sv("circle", { "class": cls, cx: pp[0], cy: pp[1] + dy, r: tr }, svg);
    });

    // bowl: a wide, shallow vessel (no stove, no flame)
    sv("path", { "class": "pot-body", d: "M48 112 L192 112 Q188 170 120 176 Q52 170 48 112 Z" }, svg);
    sv("rect", { "class": "pot-rim", x: 40, y: 104, width: 160, height: 13, rx: 6.5 }, svg);
    // bowl foot
    sv("path", { "class": "pot-rim", d: "M96 176 Q120 184 144 176 L140 186 Q120 192 100 186 Z" }, svg);
    [[72, 130], [92, 150], [120, 160], [150, 150], [168, 132], [110, 158], [134, 158]].forEach(function (pp, i) {
      sv("circle", { "class": "pot-spk", cx: pp[0], cy: pp[1], r: i % 3 ? 1.3 : 2 }, svg);
    });

    // caption: band-specific completion message under the bowl
    var cap = document.createElement("div");
    cap.className = "heat bowl-done";
    var msg = document.createElement("p");
    msg.className = "done-message";
    msg.textContent = DONE_MESSAGE[band] || "All done.";
    cap.appendChild(msg);
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
  // --- Today's tasks: ONE list through the whole flow --------------------
  //
  // After tagging, the SAME list is reordered in place and each task carries
  // its own done checkbox, per-task reason, and a "Not today" (skip) control.
  // No second list. A task's status is one of: "pending" (not acted on),
  // "done", or "skipped" (deferred to tomorrow; excluded from completion rates).
  let tasks = [];
  let reordered = false; // has the user reordered today's list yet?

  const TYPE_LABELS = window.HuifanTag.TASK_TYPES; // the five types
  const EFFORT_LABELS = { 1: "Light", 2: "Medium", 3: "Heavy" };
  const DUE_LABELS = { today: "Today", tomorrow: "Tomorrow", later: "Later" };

  function renderTasksSection() {
    const section = document.getElementById("tasks-section");
    if (!section) return;

    section.innerHTML =
      "<h2>Today's tasks</h2>" +
      '<p class="muted tasks-help">One task per line. We guess a type from ' +
      "keywords — fix any we got wrong, then reorder for today.</p>" +
      '<textarea id="task-input" class="task-input" rows="5" ' +
      'placeholder="write lab report&#10;read chapter 4&#10;' +
      'reply to emails&#10;fitrec work out&#10;coffee with Sam"></textarea>' +
      '<div class="task-actions">' +
      '<button id="tag-btn" class="btn">Tag tasks</button>' +
      '<button id="reorder-btn" class="btn btn--secondary">Reorder for today</button>' +
      "</div>" +
      '<ul id="task-list" class="task-list"></ul>' +
      '<div class="task-foot">' +
      '<p id="reorder-note" class="reorder-note muted"></p>' +
      '<button id="export-btn" class="btn btn--secondary">Export history (JSON)</button>' +
      "</div>";

    section.querySelector("#tag-btn").addEventListener("click", onTagClick);
    section.querySelector("#reorder-btn").addEventListener("click", onReorderClick);
    section.querySelector("#export-btn").addEventListener("click", onExportClick);

    renderTaskList();
  }

  function onTagClick() {
    const input = document.getElementById("task-input");
    if (!input) return;
    tasks = window.HuifanTag.parseTasks(input.value).map(function (t) {
      return Object.assign({}, t, { status: "pending" });
    });
    reordered = false;
    // Carry over any status already saved for today (so a re-tag keeps taps).
    const savedToday = loadHistory()[todayScore.date] || [];
    const byText = {};
    savedToday.forEach(function (r) { byText[r.task_text] = r; });
    // Also pull any tasks the user deferred yesterday into today's input is
    // handled at boot (prefillDeferred); here we just restore status.
    tasks.forEach(function (t) {
      const prev = byText[t.text];
      if (prev && prev.status) t.status = prev.status;
      else if (prev && typeof prev.done === "boolean") t.status = prev.done ? "done" : "pending";
    });
    setReorderNote("");
    renderTaskList();
    persistToday();
    drawPot();
  }

  function onReorderClick() {
    if (tasks.length === 0) {
      setReorderNote("Add and tag some tasks first.");
      return;
    }
    // Reorder the active (non-skipped) tasks in place; skipped tasks drop out
    // of today's order entirely.
    const active = tasks.filter(function (t) { return t.status !== "skipped"; });
    const result = window.HuifanOrder.reorderTasks(active, recoveryContext);
    // Rebuild `tasks` as: reordered active tasks, then skipped ones appended,
    // carrying the per-task reason/chunk annotations onto the same objects.
    const annotById = {};
    result.ordered.forEach(function (o) { annotById[o.id] = o; });
    const skipped = tasks.filter(function (t) { return t.status === "skipped"; });
    tasks = result.ordered.map(function (o) {
      const orig = active.find(function (t) { return t.id === o.id; }) || {};
      return Object.assign(orig, { movedBy: o.movedBy, chunk: o.chunk });
    }).concat(skipped);
    reordered = true;
    setReorderNote(result.notes);
    renderTaskList();
    persistToday();
    drawPot();
  }

  function setReorderNote(text) {
    const n = document.getElementById("reorder-note");
    if (n) n.textContent = text || "";
  }

  function renderTaskList() {
    const list = document.getElementById("task-list");
    if (!list) return;

    if (tasks.length === 0) {
      list.innerHTML =
        '<li class="muted task-empty">No tasks yet. Type some above and tag them.</li>';
      return;
    }

    list.innerHTML = tasks.map(renderTaskItem).join("");
    wireTaskControls(list);
  }

  // One task row: checkbox + text (+ guessed flag) + editable labelled selects
  // + per-task reason + "Not today".
  function renderTaskItem(t, idx) {
    const typeOpts = TYPE_LABELS.map(function (ty) {
      return '<option value="' + ty + '"' + (ty === t.type ? " selected" : "") + ">" + ty + "</option>";
    }).join("");
    const effortOpts = [1, 2, 3].map(function (e) {
      return '<option value="' + e + '"' + (e === t.effort ? " selected" : "") + ">" + EFFORT_LABELS[e] + "</option>";
    }).join("");
    const dueVal = t.due || "later";
    const dueOpts = ["today", "tomorrow", "later"].map(function (d) {
      return '<option value="' + d + '"' + (d === dueVal ? " selected" : "") + ">" + DUE_LABELS[d] + "</option>";
    }).join("");

    const skipped = t.status === "skipped";
    const done = t.status === "done";
    const guessedFlag = t.guessed
      ? '<span class="guessed-flag" title="No keyword matched; we guessed. Check the type.">guessed — check the type</span>'
      : "";
    const reason = (reordered && t.movedBy)
      ? '<span class="move-reason">' + escapeHtml(t.movedBy) + "</span>" : "";
    const chunk = (reordered && t.chunk)
      ? '<span class="chunk-hint">' + escapeHtml(t.chunk) + "</span>" : "";

    return (
      '<li class="task-item' + (done ? " task-item--done" : "") + (skipped ? " task-item--skipped" : "") +
      '" data-idx="' + idx + '">' +
      '<button class="task-check" data-idx="' + idx + '" role="checkbox" ' +
      'aria-checked="' + (done ? "true" : "false") + '" ' +
      'aria-label="Mark done" ' + (skipped ? "disabled" : "") + ">" +
      (done ? "\u2713" : "\u25CB") + "</button>" +
      '<span class="task-main">' +
      '<span class="task-text">' + escapeHtml(t.text) + "</span> " + guessedFlag +
      '<span class="task-controls">' +
      '<label class="ctl"><span class="ctl-label">Type</span>' +
      '<select class="task-type" data-idx="' + idx + '">' + typeOpts + "</select></label>" +
      '<label class="ctl"><span class="ctl-label">Effort</span>' +
      '<select class="task-effort" data-idx="' + idx + '">' + effortOpts + "</select></label>" +
      '<label class="ctl"><span class="ctl-label">Due</span>' +
      '<select class="task-due" data-idx="' + idx + '">' + dueOpts + "</select></label>" +
      "</span>" +
      reason + chunk +
      (skipped ? '<span class="skip-flag">\u2192 tomorrow</span>' : "") +
      "</span>" +
      '<button class="task-skip" data-idx="' + idx + '">' +
      (skipped ? "Undo" : "Not today") + "</button>" +
      "</li>"
    );
  }

  function wireTaskControls(list) {
    list.querySelectorAll(".task-type").forEach(function (sel) {
      sel.addEventListener("change", function (e) {
        const i = Number(e.target.getAttribute("data-idx"));
        if (tasks[i]) { tasks[i].type = e.target.value; tasks[i].guessed = false; persistToday(); }
      });
    });
    list.querySelectorAll(".task-effort").forEach(function (sel) {
      sel.addEventListener("change", function (e) {
        const i = Number(e.target.getAttribute("data-idx"));
        if (tasks[i]) { tasks[i].effort = Number(e.target.value); persistToday(); }
      });
    });
    list.querySelectorAll(".task-due").forEach(function (sel) {
      sel.addEventListener("change", function (e) {
        const i = Number(e.target.getAttribute("data-idx"));
        if (tasks[i]) { tasks[i].due = e.target.value; persistToday(); }
      });
    });
    list.querySelectorAll(".task-check").forEach(function (btn) {
      btn.addEventListener("click", function () {
        toggleDone(Number(btn.getAttribute("data-idx")));
      });
    });
    list.querySelectorAll(".task-skip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        toggleSkip(Number(btn.getAttribute("data-idx")));
      });
    });
  }

  function toggleDone(idx) {
    const t = tasks[idx];
    if (!t || t.status === "skipped") return;

    // Were all non-skipped tasks already done before this tick?
    const wasAllDone = isAllDone();
    const turningOn = t.status !== "done";
    t.status = turningOn ? "done" : "pending";

    // If we just ticked a task on, pop its topping (index within the
    // non-skipped list, matching potTasks()/drawPot ordering).
    if (turningOn) {
      popToppingIndex = nonSkippedIndexOf(idx);
    } else {
      popToppingIndex = null;
    }

    persistToday();
    renderTaskList();
    drawPot();

    // Fire the completion reward only on the transition into all-done.
    const nowAllDone = isAllDone();
    if (nowAllDone && !wasAllDone) {
      potState.celebrated = true;
      celebrate();
    } else if (!nowAllDone) {
      potState.celebrated = false; // unticking puts the pot back; allow re-fire
    }
  }

  // True when there is at least one non-skipped task and all of them are done.
  function isAllDone() {
    const active = (tasks || []).filter(function (t) { return t.status !== "skipped"; });
    return active.length > 0 && active.every(function (t) { return t.status === "done"; });
  }

  // Map a `tasks` index to its position among non-skipped tasks (the order the
  // pot/bowl toppings are drawn in).
  function nonSkippedIndexOf(idx) {
    var k = -1;
    for (var i = 0; i <= idx && i < tasks.length; i++) {
      if (tasks[i].status !== "skipped") k++;
    }
    return k;
  }

  var prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Completion reward: a short full-screen confetti burst, then a smooth
  // scroll up to the bowl. Respects prefers-reduced-motion (then: no confetti,
  // no scroll animation — the bowl + message are already drawn by drawPot).
  function celebrate() {
    if (prefersReducedMotion) {
      scrollToPot(false);
      return;
    }
    fireConfetti();
    scrollToPot(true);
  }

  function scrollToPot(smooth) {
    var box = document.getElementById("pot-box");
    if (!box || typeof box.scrollIntoView !== "function") return;
    try {
      box.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
    } catch (e) {
      box.scrollIntoView();
    }
  }

  // Pure JS/CSS confetti: a fixed overlay with short-lived falling pieces that
  // removes itself. No library.
  function fireConfetti() {
    var overlay = document.createElement("div");
    overlay.className = "confetti-overlay";
    overlay.setAttribute("aria-hidden", "true");
    var colors = ["#E2571C", "#F7B32B", "#3E9B4F", "#1D4AA0", "#E77B6E", "#E8892B"];
    var N = 90;
    for (var i = 0; i < N; i++) {
      var piece = document.createElement("span");
      piece.className = "confetti-piece";
      var left = Math.random() * 100;
      var delay = Math.random() * 0.25;
      var dur = 1.4 + Math.random() * 1.1;
      var rot = Math.floor(Math.random() * 360);
      var drift = (Math.random() * 2 - 1) * 60;
      piece.style.left = left + "vw";
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = delay + "s";
      piece.style.animationDuration = dur + "s";
      piece.style.setProperty("--rot", rot + "deg");
      piece.style.setProperty("--drift", drift + "px");
      if (i % 3 === 0) piece.style.borderRadius = "50%"; // mix circles + rects
      overlay.appendChild(piece);
    }
    document.body.appendChild(overlay);
    // Remove after the longest piece finishes.
    window.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 3000);
  }

  // "Not today": skip the task — it leaves today's order, logs as "skipped",
  // and is pre-filled into tomorrow's list at next boot. Toggling again undoes.
  function toggleSkip(idx) {
    const t = tasks[idx];
    if (!t) return;
    t.status = t.status === "skipped" ? "pending" : "skipped";
    persistToday();
    renderTaskList();
    drawPot();
  }

  function persistToday() {
    const records = tasks.map(function (t) { return buildRecord(t); });
    saveTodayRecords(records);
  }

  function onExportClick() {
    const all = flattenHistory();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "huifan-history.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
  // Days of logs before a real user's own pattern analysis is meaningful.
  const PATTERNS_MIN_DAYS = 14;

  // Compute the user's OWN Beta-Binomial analysis in the browser from their
  // logged check-in history (localStorage). Returns null if patterns-core is
  // unavailable. Pure per-user; no simulated data involved.
  function ownPatternsAnalysis() {
    if (!window.HuifanPatternsCore) return null;
    const records = window.HuifanPatternsCore.recordsFromHistory(loadHistory());
    if (records.length === 0) return null;
    return window.HuifanPatternsCore.analyze(records);
  }

  // Which task types the reorder may move later on low-recovery days.
  //
  // SAMPLE mode (demo): use the committed SIMULATED demotable_types so the demo
  // shows the full loop. REAL/local data: demotions come ONLY from the user's
  // OWN in-browser analysis, and only once they have enough logged days AND a
  // type's green-minus-red interval excludes zero. Until then, empty — the
  // reorder keeps the user's order. Simulated data never touches real users.
  function loadLearnedDemotions(source) {
    if (source === "sample") {
      const p = window.HUIFAN_PATTERNS;
      return p && p.simulated === true && Array.isArray(p.demotable_types)
        ? p.demotable_types.slice()
        : [];
    }
    // real or local
    if (loggedDayCount() < PATTERNS_MIN_DAYS) return [];
    const a = ownPatternsAnalysis();
    return a ? window.HuifanPatternsCore.demotableTypes(a) : [];
  }

  // "Not today" carries a task forward: on a later day, any task skipped on the
  // most recent prior logged day is pre-filled into today's input so it
  // reappears in tomorrow's list. Pure of the current day's edits.
  function prefillDeferredTasks() {
    const input = document.getElementById("task-input");
    if (!input || input.value.trim() !== "") return; // don't clobber typed text
    const history = loadHistory();
    const today = todayScore.date;
    const priorDates = Object.keys(history)
      .filter(function (d) { return d !== today && Array.isArray(history[d]); })
      .sort();
    if (priorDates.length === 0) return;
    const last = priorDates[priorDates.length - 1];
    const deferred = history[last]
      .filter(function (r) { return r.status === "skipped"; })
      .map(function (r) { return r.task_text; });
    if (deferred.length === 0) return;
    input.value = deferred.join("\n");
    // Tag them immediately so they show up as today's list, carrying status
    // "pending" (a fresh day).
    onTagClick();
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
        minDays: PATTERNS_MIN_DAYS,
        ownAnalysis:
          source !== "sample" && loggedDayCount() >= PATTERNS_MIN_DAYS
            ? ownPatternsAnalysis()
            : null,
      });
    }
    if (window.HuifanInsights) {
      window.HuifanInsights.renderInsights("insights-section");
    }
    prefillDeferredTasks();
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
