// parse-core.js — pure Apple Health parsing + daily aggregation.
//
// This is the parity-critical core: its output MUST match scripts/parse_health.py
// field-for-field for the same export. It is PURE — no DOM, no Worker, no I/O —
// so the Web Worker (js/parse-worker.js) and the vitest tests can both use it.
//
// Dual consumption, no build step:
//   - In a classic Web Worker, importScripts("parse-core.js") runs this IIFE and
//     self.HuifanParseCore becomes available (no import/export keywords).
//   - Under vitest, the test does require(".../parse-core.js") via createRequire,
//     exactly like tests/score.property.test.js loads js/score.js.
//
// All comments in English. Numbers that mirror the Python live in named consts.

(function (root) {
  "use strict";

  // Apple Health record type identifiers (mirrors parse_health.py).
  var TYPES = {
    HRV: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    RHR: "HKQuantityTypeIdentifierRestingHeartRate",
    RESP: "HKQuantityTypeIdentifierRespiratoryRate",
    SLEEP: "HKCategoryTypeIdentifierSleepAnalysis",
  };

  // Sleep category values that count as "asleep". InBed and Awake are excluded.
  var ASLEEP_VALUES = {
    HKCategoryValueSleepAnalysisAsleep: true,
    HKCategoryValueSleepAnalysisAsleepCore: true,
    HKCategoryValueSleepAnalysisAsleepDeep: true,
    HKCategoryValueSleepAnalysisAsleepREM: true,
    HKCategoryValueSleepAnalysisAsleepUnspecified: true,
  };

  var MS_PER_HOUR = 3600 * 1000;

  // --- round2: match CPython round(x, 2) exactly --------------------------
  //
  // Python rounds the TRUE value of the IEEE-754 double to nearest, ties to
  // even. JavaScript's Math.round rounds half up, and toFixed is not reliable
  // for ties, so we expand the double to its full decimal form (toFixed(25),
  // which shows the real digits rather than the shortest round-tripping string)
  // and round that decimal with BigInt, ties-to-even. Verified equal to Python
  // round(x, 2) across thousands of values including hard half-cases.
  function round2(x) {
    if (typeof x !== "number" || !isFinite(x)) return x;
    if (Object.is(x, -0)) return 0;
    if (x < 0) {
      var r = round2(-x);
      return r === 0 ? 0 : -r;
    }
    var s = x.toFixed(25); // full expansion; always has a '.' for our range
    var dot = s.indexOf(".");
    var intPart = s.slice(0, dot);
    var frac = s.slice(dot + 1);
    var keep = frac.slice(0, 2).padEnd(2, "0");
    var rest = frac.slice(2);
    var hundredths = BigInt(intPart) * 100n + BigInt(keep);
    var firstRest = rest[0] || "0";
    var roundUp;
    if (firstRest > "5") {
      roundUp = true;
    } else if (firstRest < "5") {
      roundUp = false;
    } else {
      var tail = rest.slice(1).replace(/0+$/, "");
      if (tail.length > 0) roundUp = true; // strictly greater than half
      else roundUp = hundredths % 2n === 1n; // exact half -> ties to even
    }
    if (roundUp) hundredths += 1n;
    return Number(hundredths) / 100;
  }

  // --- parseAppleDateTime -------------------------------------------------
  //
  // Parse "YYYY-MM-DD HH:MM:SS ±HHMM" (Apple's format, Python
  // strptime("%Y-%m-%d %H:%M:%S %z")). Returns { ms, dateISO } where:
  //   ms     = absolute epoch milliseconds (offset applied), for interval math
  //   dateISO= the LOCAL calendar date in the record's own offset, matching
  //            Python's tz-aware datetime .date().
  // Returns null on malformed input so the caller can skip the record (mirrors
  // Python's except (ValueError, TypeError)).
  var DT_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/;
  function parseAppleDateTime(s) {
    if (typeof s !== "string") return null;
    var m = DT_RE.exec(s);
    if (!m) return null;
    var year = +m[1], mon = +m[2], day = +m[3];
    var hh = +m[4], mm = +m[5], ss = +m[6];
    var off = m[7];
    var offSign = off[0] === "-" ? -1 : 1;
    var offMin = offSign * (parseInt(off.slice(1, 3), 10) * 60 + parseInt(off.slice(3, 5), 10));
    // Absolute instant: treat the wall-clock as UTC, then subtract the offset.
    var wallUTC = Date.UTC(year, mon - 1, day, hh, mm, ss);
    if (isNaN(wallUTC)) return null;
    var ms = wallUTC - offMin * 60 * 1000;
    // Local calendar date is just the date part of the wall-clock in its own
    // offset, i.e. the Y-M-D the string already carries.
    var dateISO = m[1] + "-" + m[2] + "-" + m[3];
    return { ms: ms, dateISO: dateISO };
  }

  // Wake date = the local calendar date of the interval's END time.
  function wakeDate(endDateISO) {
    return endDateISO;
  }

  // --- dailyMean ----------------------------------------------------------
  // Mean of values rounded to 2dp, or null when empty (never 0). Mirrors
  // parse_health.mean_or_none.
  function dailyMean(values) {
    if (!values || values.length === 0) return null;
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    return round2(sum / values.length);
  }

  // --- mergeIntervals -----------------------------------------------------
  // Merge overlapping (startMs, endMs) intervals; return total non-overlapping
  // duration in SECONDS. Input need not be sorted. Mirrors
  // parse_health.merge_intervals (touching intervals merge: start <= cur_end).
  function mergeIntervals(intervals) {
    if (!intervals || intervals.length === 0) return 0;
    var sorted = intervals.slice().sort(function (a, b) {
      return a[0] - b[0];
    });
    var totalMs = 0;
    var curStart = sorted[0][0];
    var curEnd = sorted[0][1];
    for (var i = 1; i < sorted.length; i++) {
      var start = sorted[i][0];
      var end = sorted[i][1];
      if (start <= curEnd) {
        if (end > curEnd) curEnd = end;
      } else {
        totalMs += curEnd - curStart;
        curStart = start;
        curEnd = end;
      }
    }
    totalMs += curEnd - curStart;
    return totalMs / 1000;
  }

  // --- extractRecordsFromChunks -------------------------------------------
  //
  // A hand-written, streaming XML scanner. NOT a DOM parser (DOMParser is not
  // available in a Web Worker). It finds complete <Record .../> elements as
  // text chunks arrive, extracts the attributes we need, and reassembles a
  // Record split across chunk boundaries.
  //
  // Returns a stateful scanner:
  //   scanner.push(textChunk)  -> void  (parses any now-complete records)
  //   scanner.records          -> RawRecord[]  accumulated so far
  //   scanner.end()            -> void  (no-op; present for symmetry)
  // RawRecord = { type, value?, startDate?, endDate? }
  var ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;
  function extractRecordsFromChunks() {
    var buffer = "";
    var records = [];

    function parseRecordTag(tag) {
      // tag is the text between "<Record" and the closing "/>" or ">".
      var attrs = {};
      ATTR_RE.lastIndex = 0;
      var m;
      while ((m = ATTR_RE.exec(tag)) !== null) {
        attrs[m[1]] = m[2];
      }
      records.push({
        type: attrs.type,
        value: attrs.value,
        startDate: attrs.startDate,
        endDate: attrs.endDate,
      });
    }

    function push(chunk) {
      buffer += chunk;
      while (true) {
        var open = buffer.indexOf("<Record");
        if (open === -1) {
          // Keep only a small tail in case "<Record" is split across chunks.
          if (buffer.length > 8) buffer = buffer.slice(buffer.length - 8);
          return;
        }
        // Find the end of this element. Self-closing "/>" or a plain ">".
        // Attribute values are quoted and cannot contain a bare '>' in valid
        // Apple exports, so the first '>' after the open tag ends the element.
        var gt = buffer.indexOf(">", open);
        if (gt === -1) {
          // Element not complete yet — wait for more chunks. Drop anything
          // before the open tag so the buffer stays flat.
          buffer = buffer.slice(open);
          return;
        }
        var inner = buffer.slice(open + "<Record".length, gt);
        // Strip a trailing '/' for self-closing tags.
        if (inner.charAt(inner.length - 1) === "/") {
          inner = inner.slice(0, inner.length - 1);
        }
        parseRecordTag(inner);
        buffer = buffer.slice(gt + 1);
      }
    }

    return {
      push: push,
      end: function () {},
      get records() {
        return records;
      },
    };
  }

  // --- aggregate ----------------------------------------------------------
  // Fold RawRecords into the accumulators that buildDaily reduces. Mirrors the
  // per-day dicts in parse_health.py. Malformed records are skipped.
  function newAccumulators() {
    return { hrv: {}, rhr: {}, resp: {}, sleep: {} };
  }

  function accumulate(acc, rec) {
    var t = rec.type;
    if (t === TYPES.HRV || t === TYPES.RHR || t === TYPES.RESP) {
      var val = parseFloat(rec.value);
      if (isNaN(val)) return; // skip malformed value
      var dt = parseAppleDateTime(rec.startDate);
      if (!dt) return;
      var store = t === TYPES.HRV ? acc.hrv : t === TYPES.RHR ? acc.rhr : acc.resp;
      if (!store[dt.dateISO]) store[dt.dateISO] = [];
      store[dt.dateISO].push(val);
    } else if (t === TYPES.SLEEP) {
      if (!ASLEEP_VALUES[rec.value]) return; // only asleep stages
      var start = parseAppleDateTime(rec.startDate);
      var end = parseAppleDateTime(rec.endDate);
      if (!start || !end) return;
      if (end.ms <= start.ms) return;
      var day = wakeDate(end.dateISO);
      if (!acc.sleep[day]) acc.sleep[day] = [];
      acc.sleep[day].push([start.ms, end.ms]);
    }
  }

  // --- buildDaily ---------------------------------------------------------
  // Reduce accumulators into the sorted, unique-date Daily_Record[]. Direct
  // port of parse_health.build_daily.
  function buildDaily(acc) {
    var daySet = {};
    ["hrv", "rhr", "resp", "sleep"].forEach(function (k) {
      for (var d in acc[k]) if (Object.prototype.hasOwnProperty.call(acc[k], d)) daySet[d] = true;
    });
    var days = Object.keys(daySet).sort();
    var rows = [];
    for (var i = 0; i < days.length; i++) {
      var day = days[i];
      var sleepSeconds = mergeIntervals(acc.sleep[day] || []);
      var sleepH = sleepSeconds > 0 ? round2(sleepSeconds / 3600) : null;
      rows.push({
        date: day,
        hrv: dailyMean(acc.hrv[day] || []),
        rhr: dailyMean(acc.rhr[day] || []),
        resp: dailyMean(acc.resp[day] || []),
        sleep_h: sleepH,
      });
    }
    return rows;
  }

  // --- filterLastNMonths --------------------------------------------------
  // Keep rows whose date is within `months` of the most recent record date in
  // the dataset (anchored on the max date, not today). A row needs a valid
  // date. Range "all" simply does not call this (identity).
  function filterLastNMonths(rows, months) {
    if (!rows || rows.length === 0) return [];
    var maxISO = null;
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].date;
      if (typeof d === "string" && (maxISO === null || d > maxISO)) maxISO = d;
    }
    if (maxISO === null) return [];
    // Cutoff = maxDate minus `months` calendar months (inclusive).
    var parts = maxISO.split("-");
    var y = +parts[0], mo = +parts[1], da = +parts[2];
    var cutoff = new Date(Date.UTC(y, mo - 1, da));
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    var cutoffISO = cutoff.toISOString().slice(0, 10);
    return rows.filter(function (r) {
      return typeof r.date === "string" && r.date >= cutoffISO;
    });
  }

  // --- parseXmlText: convenience for tests and the worker -----------------
  // Stream a whole XML string (optionally pre-split by the caller) through the
  // scanner + accumulators and build the dataset. For true streaming the worker
  // calls the pieces directly; this helper keeps the parity test simple.
  function parseXmlChunks(chunks, range) {
    var scanner = extractRecordsFromChunks();
    var acc = newAccumulators();
    var seen = 0;
    for (var i = 0; i < chunks.length; i++) {
      scanner.push(chunks[i]);
      // Drain newly-parsed records into the accumulators as we go, so memory
      // stays flat (we don't keep the full record list around).
      for (; seen < scanner.records.length; seen++) {
        accumulate(acc, scanner.records[seen]);
      }
    }
    scanner.end();
    for (; seen < scanner.records.length; seen++) {
      accumulate(acc, scanner.records[seen]);
    }
    var rows = buildDaily(acc);
    if (range === "6m") rows = filterLastNMonths(rows, 6);
    return rows;
  }

  var api = {
    TYPES: TYPES,
    ASLEEP_VALUES: ASLEEP_VALUES,
    round2: round2,
    parseAppleDateTime: parseAppleDateTime,
    wakeDate: wakeDate,
    dailyMean: dailyMean,
    mergeIntervals: mergeIntervals,
    extractRecordsFromChunks: extractRecordsFromChunks,
    newAccumulators: newAccumulators,
    accumulate: accumulate,
    buildDaily: buildDaily,
    filterLastNMonths: filterLastNMonths,
    parseXmlChunks: parseXmlChunks,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // vitest (createRequire)
  }
  root.HuifanParseCore = api; // browser window OR worker self
})(typeof self !== "undefined" ? self : this);
