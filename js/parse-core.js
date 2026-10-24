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
  // Compensated (Neumaier) summation — CPython's float sum() uses this since
  // 3.12, and a naive left-to-right fold can land on the OTHER side of a 2-dp
  // rounding boundary (e.g. 132.105 vs 132.10500000000002 for three real HRV
  // values). To keep byte-for-byte parity with parse_health.py's
  // round(sum(values)/len, 2) we must sum the SAME way Python does.
  function neumaierSum(values) {
    var sum = 0.0;
    var c = 0.0; // running compensation for lost low-order bits
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      var t = sum + x;
      if (Math.abs(sum) >= Math.abs(x)) {
        c += (sum - t) + x;
      } else {
        c += (x - t) + sum;
      }
      sum = t;
    }
    return sum + c;
  }

  // Mean of values rounded to 2dp, or null when empty (never 0). Mirrors
  // parse_health.mean_or_none, including Python's compensated sum().
  function dailyMean(values) {
    if (!values || values.length === 0) return null;
    return round2(neumaierSum(values) / values.length);
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
  //
  // CRITICAL for large exports: the scanner retains NOTHING. Each complete
  // <Record> is handed to an onRecord callback and dropped. The caller folds it
  // into the accumulators immediately, so memory stays flat even for a ~1 GB
  // decompressed XML (a real export has ~1.5M+ records). For the tests, an
  // optional { collect: true } keeps a records[] array for convenience.
  var ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;
  function extractRecordsFromChunks(opts) {
    opts = opts || {};
    var onRecord = typeof opts.onRecord === "function" ? opts.onRecord : null;
    var collect = !!opts.collect || !onRecord; // default: collect if no callback
    var buffer = "";
    var records = collect ? [] : null;

    function emit(tag) {
      // tag is the text between "<Record" and the closing "/>" or ">".
      var attrs = {};
      ATTR_RE.lastIndex = 0;
      var m;
      while ((m = ATTR_RE.exec(tag)) !== null) {
        attrs[m[1]] = m[2];
      }
      var rec = {
        type: attrs.type,
        value: attrs.value,
        startDate: attrs.startDate,
        endDate: attrs.endDate,
      };
      if (onRecord) onRecord(rec);
      if (collect) records.push(rec);
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
        // Drop anything before the open tag so the buffer never grows with
        // the skipped XML between Records.
        if (open > 0) buffer = buffer.slice(open);
        // Find the end of this element. Self-closing "/>" or a plain ">".
        // Attribute values are quoted and cannot contain a bare '>' in valid
        // Apple exports, so the first '>' after the open tag ends the element.
        var gt = buffer.indexOf(">");
        if (gt === -1) {
          // Element not complete yet — wait for more chunks.
          return;
        }
        var inner = buffer.slice("<Record".length, gt);
        // Strip a trailing '/' for self-closing tags.
        if (inner.charAt(inner.length - 1) === "/") {
          inner = inner.slice(0, inner.length - 1);
        }
        emit(inner);
        buffer = buffer.slice(gt + 1);
      }
    }

    return {
      push: push,
      end: function () {},
      get records() {
        return records || [];
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

  // --- createStreamingParser: the memory-flat streaming API ---------------
  //
  // The worker feeds decoded XML text chunks via push(text); each complete
  // <Record> is folded into the accumulators immediately and dropped (nothing
  // is retained). finish(range) builds the dataset. recordCount lets the caller
  // treat "0 records parsed" as an error rather than an empty success.
  function createStreamingParser() {
    var acc = newAccumulators();
    var count = 0;
    var scanner = extractRecordsFromChunks({
      onRecord: function (rec) {
        count++;
        accumulate(acc, rec);
      },
    });
    return {
      push: function (text) {
        scanner.push(text);
      },
      get recordCount() {
        return count;
      },
      finish: function (range) {
        scanner.end();
        var rows = buildDaily(acc);
        if (range === "6m") rows = filterLastNMonths(rows, 6);
        return rows;
      },
    };
  }

  // Convenience for tests: stream an array of text chunks and build the dataset.
  // Returns the rows; use createStreamingParser directly when you need the count.
  function parseXmlChunks(chunks, range) {
    var parser = createStreamingParser();
    for (var i = 0; i < chunks.length; i++) parser.push(chunks[i]);
    return parser.finish(range);
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
    createStreamingParser: createStreamingParser,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // vitest (createRequire)
  }
  root.HuifanParseCore = api; // browser window OR worker self
})(typeof self !== "undefined" ? self : this);
