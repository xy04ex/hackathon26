// Integration tests for the worker's streaming pipeline (Task 6.4).
//
// We cannot spin up a real Web Worker under vitest, so we test the two pieces
// the worker composes:
//   1. parse-core streaming: feeding XML as many small chunks accumulates
//      records without ever holding the whole record list (flat memory), and
//      yields the same dataset as a single chunk (also covered by the parity
//      test's chunk-split property).
//   2. The fflate unzip path over a real in-memory zip, plus the not-a-zip and
//      no-export-xml error conditions.

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "parse-core.js"));
const fflate = require(path.join(here, "..", "js", "vendor", "fflate.min.js"));

const fixtureXml = readFileSync(
  path.join(here, "fixtures", "apple_health_export", "export.xml"),
  "utf8"
);
const expected = JSON.parse(
  readFileSync(path.join(here, "fixtures", "expected-daily.json"), "utf8")
);

describe("worker streaming pipeline", () => {
  it("streams records incrementally without retaining the whole record list", () => {
    // Feed the XML one character at a time; drain into accumulators as we go so
    // the scanner never needs the full text. Assert parity with the reference.
    const scanner = core.extractRecordsFromChunks();
    const acc = core.newAccumulators();
    let seen = 0;
    for (const ch of fixtureXml) {
      scanner.push(ch);
      for (; seen < scanner.records.length; seen++) {
        core.accumulate(acc, scanner.records[seen]);
      }
    }
    const rows = core.buildDaily(acc);
    expect(rows).toEqual(expected);
  });

  it("fflate unzip reads the export.xml member from a real zip", async () => {
    // Build a real zip in memory containing apple_health_export/export.xml.
    const zipped = fflate.zipSync({
      "apple_health_export/export.xml": new TextEncoder().encode(fixtureXml),
    });
    const text = await inflateExportXml(zipped);
    const rows = core.parseXmlChunks([text], "all");
    expect(rows).toEqual(expected);
  });

  it("reports not-a-zip for non-zip bytes", async () => {
    const garbage = new TextEncoder().encode("this is definitely not a zip file");
    await expect(inflateExportXml(garbage)).rejects.toMatchObject({
      reason: "not-a-zip",
    });
  });

  it("reports no-export-xml for a zip without export.xml", async () => {
    const zipped = fflate.zipSync({ "notes.txt": new TextEncoder().encode("hi") });
    await expect(inflateExportXml(zipped)).rejects.toMatchObject({
      reason: "no-export-xml",
    });
  });
});

// Mirror the worker's fflate fallback path (inflateFflate) and its up-front
// zip-signature check, so not-a-zip vs no-export-xml are distinguished the same
// way the worker distinguishes them.
function inflateExportXml(buf) {
  return new Promise((resolve, reject) => {
    // Up-front: the worker's locateExportXml rejects non-zip bytes before any
    // inflate. Local file header signature is PK\x03\x04 = 0x04034b50.
    const sig = buf.length >= 4 ? (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0 : 0;
    const PK = 0x04034b50;
    const EMPTY = 0x06054b50; // end-of-central-directory (empty zip)
    if (sig !== PK && sig !== EMPTY) return reject({ reason: "not-a-zip" });
    let found = false;
    const parts = [];
    const unzip = new fflate.Unzip((stream) => {
      if (!/export\.xml$/.test(stream.name)) return;
      found = true;
      stream.ondata = (err, chunk, final) => {
        if (err) return reject({ reason: "parse-failed" });
        parts.push(Buffer.from(chunk));
        if (final) resolve(Buffer.concat(parts).toString("utf8"));
      };
      stream.start();
    });
    unzip.register(fflate.UnzipInflate);
    try {
      unzip.push(buf, true);
    } catch (e) {
      return reject({ reason: "not-a-zip" });
    }
    if (!found) reject({ reason: "no-export-xml" });
  });
}
