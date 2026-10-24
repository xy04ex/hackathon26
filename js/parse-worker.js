// parse-worker.js — the I/O layer of browser onboarding (a classic Web Worker).
//
// Responsibilities (thin; all parse logic is in parse-core.js):
//   - Receive { type:"parse", file, range } and { type:"cancel" }.
//   - Stream-inflate the export.xml member from the zip and feed decoded text
//     chunks into parse-core's streaming parser, which folds each <Record> and
//     retains nothing — so a ~1 GB decompressed XML never lands in memory.
//   - Post { type:"progress", compressedRead, compressedTotal },
//     { type:"done", rows }, or { type:"error", reason }.
//
// No DOM, no network. DOMParser is not available here on purpose.
//
// IMPORTANT lessons baked in (see the data-descriptor bug):
//   1. Real iPhone exports write export.xml with a DATA DESCRIPTOR (general
//      flag bit 3): the LOCAL header has compressed/uncompressed size 0 and the
//      real sizes live in the CENTRAL DIRECTORY at the end of the file. So we
//      read sizes from the central directory, never trust the local header.
//   2. fflate only emits output incrementally if we PUSH ITS INPUT IN SLICES.
//      Feeding the whole archive in one push inflates the entire member at once
//      (hundreds of MB), so we slice the input.
//   3. The decompressed XML (≈1 GB) must never be turned into one string. We
//      decode each inflate chunk with a streaming TextDecoder and feed it
//      straight to the parser.
//   4. Zero records parsed is an ERROR ("no-records"), never an empty success,
//      and we never save an empty dataset.

/* global importScripts, self, DecompressionStream */

importScripts("parse-core.js", "vendor/fflate.min.js");

var core = self.HuifanParseCore;
var fflate = self.fflate;

var cancelled = false;

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type === "parse") {
    cancelled = false;
    parse(msg.file, msg.range || "6m").catch(function (err) {
      post({ type: "error", reason: classifyError(err) });
    });
  }
};

function post(m) {
  self.postMessage(m);
}

function classifyError(err) {
  var reason = (err && err.reason) || "";
  if (reason === "not-a-zip" || reason === "no-export-xml" || reason === "no-records") {
    return reason;
  }
  return "parse-failed";
}

// --- Entry point --------------------------------------------------------
async function parse(file, range) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw { reason: "not-a-zip" };
  }
  // Read the archive bytes once (49 MB compressed — fine). We never build the
  // ~1 GB decompressed string; that is streamed and folded below.
  var zipBytes = new Uint8Array(await file.arrayBuffer());
  if (cancelled) return;

  if (!looksLikeZip(zipBytes)) throw { reason: "not-a-zip" };

  var parser = core.createStreamingParser();
  var decoder = new TextDecoder("utf-8");
  var total = zipBytes.length;

  // Stream the export.xml member's inflated bytes through the parser.
  await inflateExportXml(zipBytes, {
    onBytes: function (chunk, compressedReadSoFar) {
      if (cancelled) throw { reason: "cancelled" };
      parser.push(decoder.decode(chunk, { stream: true }));
      post({
        type: "progress",
        compressedRead: Math.min(total, compressedReadSoFar),
        compressedTotal: total,
      });
    },
  });
  if (cancelled) return;

  parser.push(decoder.decode()); // flush any trailing bytes
  if (parser.recordCount === 0) {
    // Parsed the file but found no Health records — treat as an error, never
    // a silent empty success, and never save an empty dataset.
    throw { reason: "no-records" };
  }
  var rows = parser.finish(range);
  post({ type: "done", rows: rows });
}

// --- ZIP helpers --------------------------------------------------------
function readU16(b, i) {
  return b[i] | (b[i + 1] << 8);
}
function readU32(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

// A readable zip starts with a local file header (PK\x03\x04) or, for an empty
// archive, the end-of-central-directory record (PK\x05\x06).
function looksLikeZip(b) {
  if (b.length < 4) return false;
  var sig = readU32(b, 0);
  return sig === 0x04034b50 || sig === 0x06054b50;
}

// Inflate the export.xml member and deliver its decompressed bytes in chunks
// via cb.onBytes(chunk, compressedReadSoFar). Uses fflate's streaming Unzip,
// which reads the central directory (so data-descriptor entries with zero-size
// local headers work), and feeds the input in slices so output streams.
function inflateExportXml(zipBytes, cb) {
  return new Promise(function (resolve, reject) {
    var found = false;
    var finished = false;
    var compressedRead = 0;

    var unzip = new fflate.Unzip(function (stream) {
      if (!/export\.xml$/.test(stream.name)) {
        return; // don't start() other members; they stay un-inflated
      }
      found = true;
      stream.ondata = function (err, chunk, final) {
        if (err) {
          if (!finished) {
            finished = true;
            reject({ reason: "parse-failed" });
          }
          return;
        }
        try {
          cb.onBytes(chunk, compressedRead);
        } catch (thrown) {
          if (!finished) {
            finished = true;
            reject(thrown);
          }
          return;
        }
        if (final && !finished) {
          finished = true;
          resolve();
        }
      };
      stream.start();
    });
    unzip.register(fflate.UnzipInflate);

    // Push the archive in slices so fflate inflates incrementally instead of
    // materializing the whole decompressed member at once.
    var SLICE = 1 << 20; // 1 MB of compressed input per push
    try {
      for (var off = 0; off < zipBytes.length; off += SLICE) {
        if (finished) break;
        var end = Math.min(zipBytes.length, off + SLICE);
        compressedRead = end;
        unzip.push(zipBytes.subarray(off, end), end >= zipBytes.length);
      }
    } catch (e) {
      if (!finished) {
        finished = true;
        reject({ reason: "not-a-zip" });
      }
      return;
    }

    // If fflate walked every member and never saw export.xml, it's not a Health
    // export. (When found, resolve/reject happens in ondata.)
    if (!found && !finished) {
      finished = true;
      reject({ reason: "no-export-xml" });
    }
  });
}
