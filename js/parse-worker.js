// parse-worker.js — the I/O layer of browser onboarding (a classic Web Worker).
//
// Responsibilities (keep this thin; all parse logic lives in parse-core.js):
//   - Receive { type:"parse", file, range } and { type:"cancel" }.
//   - Stream-unzip the export.zip, find the export.xml member, and stream-inflate
//     it, feeding decoded text chunks into parse-core's incremental scanner so
//     the whole decompressed XML is never held in memory.
//   - Post { type:"progress", compressedRead, compressedTotal },
//     { type:"done", rows }, or { type:"error", reason }.
//
// No DOM, no network. DOMParser is not available here on purpose — the XML scan
// is the hand-written scanner in parse-core.js.

/* global importScripts, self, DecompressionStream, TextDecoderStream */

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
  var reason = (err && err.reason) || (err && err.message) || "";
  if (reason === "not-a-zip" || reason === "no-export-xml") return reason;
  return "parse-failed";
}

// --- Entry point --------------------------------------------------------
async function parse(file, range) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw { reason: "not-a-zip" };
  }
  // Read the whole archive bytes once (the ZIP container needs random access to
  // its central directory/headers). We do NOT keep the decompressed XML in
  // memory — that is inflated and consumed as a stream of text chunks below.
  var buf = new Uint8Array(await file.arrayBuffer());
  if (cancelled) return;

  var member = locateExportXml(buf); // { name, offset, compSize, method } or null-throw
  var total = member.compSize || buf.length;

  var scanner = core.extractRecordsFromChunks();
  var acc = core.newAccumulators();
  var seen = 0;
  var decoder = new TextDecoder("utf-8");

  function onTextChunk(text) {
    scanner.push(text);
    var recs = scanner.records;
    for (; seen < recs.length; seen++) core.accumulate(acc, recs[seen]);
  }

  await inflateMemberStreaming(buf, member, {
    onBytes: function (chunk, readSoFar) {
      if (cancelled) throw { reason: "cancelled" };
      onTextChunk(decoder.decode(chunk, { stream: true }));
      post({ type: "progress", compressedRead: readSoFar, compressedTotal: total });
    },
  });
  if (cancelled) return;

  onTextChunk(decoder.decode()); // flush decoder
  scanner.end();
  var recs = scanner.records;
  for (; seen < recs.length; seen++) core.accumulate(acc, recs[seen]);

  var rows = core.buildDaily(acc);
  if (range === "6m") rows = core.filterLastNMonths(rows, 6);
  post({ type: "done", rows: rows });
}

// --- ZIP container ------------------------------------------------------
//
// Minimal local-file-header scan to find the export.xml member and its byte
// range. Supports the common case (sizes present in the local header). When
// sizes are hidden behind a data descriptor, we fall back to fflate's unzip.
function readU16(b, i) { return b[i] | (b[i + 1] << 8); }
function readU32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }

function locateExportXml(buf) {
  // Local file header signature: PK\x03\x04 = 0x04034b50.
  var i = 0;
  while (i + 30 <= buf.length) {
    var sig = readU32(buf, i);
    if (sig !== 0x04034b50) break; // not at a local header; defer to fflate
    var flags = readU16(buf, i + 6);
    var method = readU16(buf, i + 8);
    var compSize = readU32(buf, i + 18);
    var nameLen = readU16(buf, i + 26);
    var extraLen = readU16(buf, i + 28);
    var nameStart = i + 30;
    var name = utf8(buf.subarray(nameStart, nameStart + nameLen));
    var dataStart = nameStart + nameLen + extraLen;
    var hasDataDescriptor = (flags & 0x08) !== 0;
    if (/export\.xml$/.test(name) && !hasDataDescriptor && compSize > 0) {
      return { name: name, offset: dataStart, compSize: compSize, method: method, useFflate: false };
    }
    if (hasDataDescriptor || compSize === 0) {
      // Can't trust sizes from the header — use fflate for the whole archive.
      return { name: null, useFflate: true };
    }
    i = dataStart + compSize;
  }
  if (i === 0) throw { reason: "not-a-zip" };
  // Walked headers but found no export.xml: let fflate double-check (it reads
  // the central directory), then decide.
  return { name: null, useFflate: true };
}

function utf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

// --- Streaming inflate --------------------------------------------------
async function inflateMemberStreaming(buf, member, cb) {
  if (!member.useFflate && typeof DecompressionStream !== "undefined" && member.method === 8) {
    return inflateNative(buf, member, cb);
  }
  return inflateFflate(buf, cb);
}

// Native path: pipe the member's raw-deflate bytes through DecompressionStream.
async function inflateNative(buf, member, cb) {
  var comp = buf.subarray(member.offset, member.offset + member.compSize);
  var ds = new DecompressionStream("deflate-raw");
  var writer = ds.writable.getWriter();
  writer.write(comp);
  writer.close();
  var reader = ds.readable.getReader();
  var read = 0;
  while (true) {
    var r = await reader.read();
    if (r.done) break;
    read += r.value.length;
    cb.onBytes(r.value, Math.min(member.compSize, read));
  }
}

// Fallback path: fflate streaming Unzip. Handles container edge cases and
// browsers without DecompressionStream. Still streams chunk-by-chunk.
function inflateFflate(buf, cb) {
  return new Promise(function (resolve, reject) {
    var found = false;
    var read = 0;
    var unzip = new fflate.Unzip(function (stream) {
      if (!/export\.xml$/.test(stream.name)) {
        return; // skip non-matching members; don't start()
      }
      found = true;
      stream.ondata = function (err, chunk, final) {
        if (err) return reject({ reason: "parse-failed" });
        try {
          read += chunk.length;
          cb.onBytes(chunk, read);
        } catch (thrown) {
          return reject(thrown);
        }
        if (final) resolve();
      };
      stream.start();
    });
    unzip.register(fflate.UnzipInflate);
    try {
      unzip.push(buf, true);
    } catch (err) {
      return reject({ reason: "not-a-zip" });
    }
    if (!found) reject({ reason: "no-export-xml" });
  });
}
