// Regression tests for the data-descriptor zip bug (real iPhone exports).
//
// Root cause we are guarding against:
//   - iPhone export.zip writes export.xml with general-purpose flag bit 3 set
//     (a DATA DESCRIPTOR): the LOCAL header's compressed/uncompressed sizes are
//     0 and the real sizes live in the central directory. The old native
//     DecompressionStream path read 0 bytes and silently produced an empty XML,
//     so the browser reported 0 days while Python reported 1556. No error shown.
//   - The scanner also must retain nothing and the worker must feed fflate in
//     slices, or a ~1 GB decompressed XML blows the heap / string limit.
//   - 0 records parsed must be an ERROR, never an empty success.
//
// We test the worker's streaming unzip path (mirrored here) over a real
// data-descriptor zip, assert parity with the reference output, and assert the
// scanner retains nothing.

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "parse-core.js"));
const fflate = require(path.join(here, "..", "js", "vendor", "fflate.min.js"));

const expected = JSON.parse(
  readFileSync(path.join(here, "fixtures", "expected-daily.json"), "utf8")
);

// Mirror js/parse-worker.js inflateExportXml: streaming Unzip, sliced input,
// streaming decode into the streaming parser. Returns rows (range "all").
function parseZip(zipBytes, range) {
  return new Promise((resolve, reject) => {
    const parser = core.createStreamingParser();
    const decoder = new TextDecoder("utf-8");
    let found = false;
    let finished = false;
    const unzip = new fflate.Unzip((stream) => {
      if (!/export\.xml$/.test(stream.name)) return;
      found = true;
      stream.ondata = (err, chunk, final) => {
        if (err) {
          if (!finished) { finished = true; reject({ reason: "parse-failed" }); }
          return;
        }
        parser.push(decoder.decode(chunk, { stream: true }));
        if (final && !finished) {
          finished = true;
          parser.push(decoder.decode());
          if (parser.recordCount === 0) return reject({ reason: "no-records" });
          resolve(parser.finish(range || "all"));
        }
      };
      stream.start();
    });
    unzip.register(fflate.UnzipInflate);
    const SLICE = 1 << 20;
    try {
      for (let off = 0; off < zipBytes.length; off += SLICE) {
        if (finished) break;
        const end = Math.min(zipBytes.length, off + SLICE);
        unzip.push(zipBytes.subarray(off, end), end >= zipBytes.length);
      }
    } catch (e) {
      if (!finished) { finished = true; reject({ reason: "not-a-zip" }); }
      return;
    }
    if (!found && !finished) reject({ reason: "no-export-xml" });
  });
}

describe("data-descriptor zip (iPhone export shape)", () => {
  const ddPath = path.join(here, "fixtures", "export-datadesc.zip");

  it("parses an export.xml stored with a data descriptor (flag bit 3)", async () => {
    expect(existsSync(ddPath)).toBe(true);
    const zipBytes = new Uint8Array(readFileSync(ddPath));
    const rows = await parseZip(zipBytes, "all");
    expect(rows).toEqual(expected); // same fixture content -> same reference rows
  });

  it("a zip whose export.xml has no Health records fails with no-records", async () => {
    const emptyXml = '<?xml version="1.0"?><HealthData></HealthData>';
    const zip = fflate.zipSync({
      "apple_health_export/export.xml": new TextEncoder().encode(emptyXml),
    });
    await expect(parseZip(zip, "all")).rejects.toMatchObject({ reason: "no-records" });
  });

  it("the scanner retains nothing when driven with an onRecord callback", () => {
    let emitted = 0;
    const scanner = core.extractRecordsFromChunks({ onRecord: () => emitted++ });
    for (let i = 0; i < 5000; i++) {
      scanner.push(
        '<Record type="HKQuantityTypeIdentifierRestingHeartRate" ' +
          'startDate="2024-03-01 08:00:00 -0500" ' +
          'endDate="2024-03-01 08:00:00 -0500" value="58"/>'
      );
    }
    expect(emitted).toBe(5000);
    expect(scanner.records.length).toBe(0); // nothing retained
  });

  it("dailyMean matches Python's compensated sum on the real-data edge case", () => {
    // These three real HRV values sum differently under naive vs compensated
    // summation; Python's sum() (Neumaier) rounds to 44.04, naive to 44.03.
    expect(core.dailyMean([55.3603, 42.9426, 33.8021])).toBe(44.04);
  });
});
