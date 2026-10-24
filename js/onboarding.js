// onboarding.js — first-run onboarding UI + browser-only persistence.
//
// DOM lives here; all parse logic is in the Web Worker (js/parse-worker.js) and
// the pure core (js/parse-core.js). This module:
//   - decides whether to show the first-run screen (shouldFirstRun),
//   - renders the export steps, file picker, range radios, "Try with sample
//     data", progress + cancel, friendly errors, and "Delete my data",
//   - owns the worker lifecycle,
//   - persists the parsed dataset to localStorage (wrapped in try/catch) and
//     exposes it as window.HUIFAN_DAILY so js/app.js reads it unchanged.
//
// Calm, short, non-judgemental copy throughout.

(function (root) {
  "use strict";

  var STORAGE_KEY = "huifan.daily.v1";

  // --- Persistence (all wrapped so the app survives storage being off) ----
  function saveDataset(rows) {
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
      return true;
    } catch (e) {
      return false; // private mode / disabled / quota — caller still sets global
    }
  }

  function loadDataset() {
    try {
      var raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function deleteDataset() {
    try {
      root.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    try {
      root.HUIFAN_DAILY = null;
    } catch (e) {
      /* ignore */
    }
  }

  // Show the first-run screen only when neither the store nor the real global
  // holds a non-empty dataset.
  function nonEmpty(v) {
    return Array.isArray(v) && v.length > 0;
  }
  function shouldFirstRun(storeValue, globalValue) {
    return !nonEmpty(storeValue) && !nonEmpty(globalValue);
  }

  // --- Rendering ----------------------------------------------------------
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function reRender() {
    if (root.HuifanApp && typeof root.HuifanApp.render === "function") {
      root.HuifanApp.render();
    }
  }

  function mount(sectionId) {
    var section =
      typeof sectionId === "string"
        ? root.document.getElementById(sectionId)
        : sectionId;
    if (!section) return;

    var storeValue = loadDataset();
    // Hydrate the global from the store so pickDataSource sees real data.
    if (nonEmpty(storeValue) && !nonEmpty(root.HUIFAN_DAILY)) {
      root.HUIFAN_DAILY = storeValue;
    }

    if (!shouldFirstRun(loadDataset(), root.HUIFAN_DAILY)) {
      // Data present: stay out of the way, but offer a small manage control.
      renderManage(section);
      return;
    }
    renderFirstRun(section);
  }

  function renderManage(section) {
    section.innerHTML =
      '<details class="onboarding-manage">' +
      "<summary>Your data</summary>" +
      '<p class="muted">Your health data stays in this browser.</p>' +
      '<button id="ob-download" class="btn btn--secondary">Download parsed JSON</button> ' +
      '<button id="ob-delete" class="btn btn--secondary">Delete my data</button>' +
      "</details>";
    var del = section.querySelector("#ob-delete");
    if (del)
      del.addEventListener("click", function () {
        deleteDataset();
        renderFirstRun(section);
        reRender();
      });
    var dl = section.querySelector("#ob-download");
    if (dl)
      dl.addEventListener("click", function () {
        downloadJson(root.HUIFAN_DAILY || loadDataset() || []);
      });
  }

  function renderFirstRun(section) {
    var isNarrow =
      typeof root.matchMedia === "function" &&
      root.matchMedia("(max-width: 480px)").matches;
    var phoneNote = isNarrow
      ? '<p class="muted onboarding-phone">Tip: uploading the export is easier ' +
        "from a computer.</p>"
      : "";

    section.innerHTML =
      '<div class="onboarding">' +
      "<h2>Set up 烩饭</h2>" +
      '<p class="muted">Bring in your Apple Health data to get a recovery ' +
      "score against your own baseline.</p>" +
      '<ol class="onboarding-steps">' +
      "<li>Open the <strong>Health</strong> app on your iPhone.</li>" +
      "<li>Tap your <strong>profile</strong> picture (top right).</li>" +
      "<li>Choose <strong>Export All Health Data</strong> to get " +
      "<code>export.zip</code>.</li>" +
      "</ol>" +
      '<label class="onboarding-range">How much to read:' +
      '<span class="range-opts">' +
      '<label><input type="radio" name="ob-range" value="6m" checked> ' +
      "Last 6 months</label>" +
      '<label><input type="radio" name="ob-range" value="all"> ' +
      "Everything</label>" +
      "</span></label>" +
      '<input type="file" id="ob-file" accept=".zip" class="onboarding-file">' +
      '<p class="muted onboarding-privacy">Your file is read right here in ' +
      "your browser. It is never uploaded or sent anywhere.</p>" +
      phoneNote +
      '<div class="onboarding-or"><button id="ob-sample" class="btn btn--secondary">' +
      "Try with sample data</button></div>" +
      '<div id="ob-status" class="onboarding-status" aria-live="polite"></div>' +
      "</div>";

    var fileInput = section.querySelector("#ob-file");
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (file) startParse(section, file, selectedRange(section));
    });

    var sampleBtn = section.querySelector("#ob-sample");
    sampleBtn.addEventListener("click", function () {
      tryWithSample(section);
    });
  }

  function selectedRange(section) {
    var checked = section.querySelector('input[name="ob-range"]:checked');
    return checked ? checked.value : "6m";
  }

  // --- Sample-data path (in-memory only; never persisted) -----------------
  function tryWithSample(section) {
    var sample = root.HUIFAN_SAMPLE_DAILY;
    if (!nonEmpty(sample)) {
      setStatus(section, "Sample data isn't available right now.");
      return;
    }
    // Deliberately do NOT saveDataset and do NOT set window.HUIFAN_DAILY, so
    // pickDataSource falls through to the sample badge and nothing persists.
    reRender();
    renderSampleBack(section);
  }

  function renderSampleBack(section) {
    section.innerHTML =
      '<div class="onboarding onboarding--sample">' +
      '<p class="muted">Showing sample (synthetic) data.</p>' +
      '<button id="ob-own" class="btn btn--secondary">Use my own export</button>' +
      "</div>";
    section.querySelector("#ob-own").addEventListener("click", function () {
      renderFirstRun(section);
    });
  }

  // --- Worker lifecycle ---------------------------------------------------
  var activeWorker = null;

  function startParse(section, file, range) {
    stopWorker();
    setStatus(
      section,
      '<div class="ob-progress"><div class="ob-bar" id="ob-bar" ' +
        'style="width:0%"></div></div>' +
        '<p class="muted" id="ob-pct">Reading your export…</p>' +
        '<button id="ob-cancel" class="btn btn--secondary">Cancel</button>'
    );
    var cancelBtn = section.querySelector("#ob-cancel");
    if (cancelBtn)
      cancelBtn.addEventListener("click", function () {
        stopWorker();
        renderFirstRun(section); // discard partial, back to picker
      });

    var worker;
    try {
      worker = new root.Worker("js/parse-worker.js");
    } catch (e) {
      friendlyError(section, "parse-failed");
      return;
    }
    activeWorker = worker;

    worker.onmessage = function (e) {
      var msg = e.data || {};
      if (msg.type === "progress") {
        updateProgress(section, msg.compressedRead, msg.compressedTotal);
      } else if (msg.type === "done") {
        stopWorker();
        onDone(section, msg.rows);
      } else if (msg.type === "error") {
        stopWorker();
        friendlyError(section, msg.reason);
      }
    };
    worker.onerror = function () {
      stopWorker();
      friendlyError(section, "parse-failed");
    };

    worker.postMessage({ type: "parse", file: file, range: range });
  }

  function stopWorker() {
    if (activeWorker) {
      try {
        activeWorker.postMessage({ type: "cancel" });
      } catch (e) {
        /* ignore */
      }
      try {
        activeWorker.terminate();
      } catch (e) {
        /* ignore */
      }
      activeWorker = null;
    }
  }

  function updateProgress(section, read, total) {
    var pct = total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0;
    var bar = section.querySelector("#ob-bar");
    var label = section.querySelector("#ob-pct");
    if (bar) bar.style.width = pct + "%";
    if (label) label.textContent = "Reading your export… " + pct + "%";
  }

  function onDone(section, rows) {
    saveDataset(rows); // returns false if storage is off; we still set the global
    root.HUIFAN_DAILY = rows;
    reRender();
    renderManage(section);
  }

  function friendlyError(section, reason) {
    var msg;
    if (reason === "not-a-zip" || reason === "no-export-xml") {
      msg =
        "That file doesn't look like an Apple Health export. Please pick the " +
        "<code>export.zip</code> from the Health app.";
    } else if (reason === "no-records") {
      msg =
        "We read your export but didn't find any heart-rate, sleep, or " +
        "breathing records in it. Nothing was saved.";
    } else {
      msg = "We couldn't finish reading that file. Please try again.";
    }
    // Re-render the picker, then show the message above it.
    renderFirstRun(section);
    setStatus(section, '<p class="onboarding-error">' + msg + "</p>");
  }

  function setStatus(section, html) {
    var status = section.querySelector("#ob-status");
    if (status) status.innerHTML = html;
  }

  // --- Download parsed JSON (for the real-export parity check) ------------
  // Pretty-printed with 2-space indent to match parse_health.py's
  // json.dump(indent=2), so a diff against data/daily.json is clean.
  function downloadJson(rows) {
    var text = JSON.stringify(rows, null, 2) + "\n";
    var blob = new root.Blob([text], { type: "application/json" });
    var url = root.URL.createObjectURL(blob);
    var a = root.document.createElement("a");
    a.href = url;
    a.download = "browser-daily.json";
    root.document.body.appendChild(a);
    a.click();
    root.document.body.removeChild(a);
    root.URL.revokeObjectURL(url);
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    shouldFirstRun: shouldFirstRun,
    saveDataset: saveDataset,
    loadDataset: loadDataset,
    deleteDataset: deleteDataset,
    mount: mount,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HuifanOnboarding = api;
})(typeof window !== "undefined" ? window : this);
