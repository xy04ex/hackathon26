// Parity gate test for js/parse-core.js (the gate for Requirement 5.11).
//
// Streams the committed SYNTHETIC fixture (tests/fixtures/apple_health_export/
// export.xml) through parse-core and asserts the result equals the reference
// output (tests/fixtures/expected-daily.json) produced by scripts/parse_health.py
// — field-for-field including nulls and 2-dp numbers.
//
// Regenerate expected-daily.json with:
//   python3 scripts/parse_health.py tests/fixtures/apple_health_export/export.xml
//   cp data/daily.json tests/fixtures/expected-daily.json && rm -f data/daily.js data/daily.json
//
// parse-core is loaded via createRequire because it uses a module.exports guard,
// exactly like tests/score.property.test.js loads js/score.js.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "parse-core.js"));

const fixtureXml = readFileSync(
  path.join(here, "fixtures", "apple_health_export", "export.xml"),
  "utf8"
);
const expected = JSON.parse(
  readFileSync(path.join(here, "fixtures", "expected-daily.json"), "utf8")
);

describe("parse-core parity with scripts/parse_health.py", () => {
  // Feature: browser-onboarding, Property 1: Parse/reference parity — the
  // Daily_Dataset from parse-core equals the reference parser's record list.
  it("matches the reference output as a single chunk", () => {
    const rows = core.parseXmlChunks([fixtureXml], "all");
    expect(rows).toEqual(expected);
  });

  // Feature: browser-onboarding, Property 1 (streaming): parity holds no matter
  // how the XML is split into chunks (also exercises chunk-boundary handling).
  it("matches the reference output for any chunk split", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: fixtureXml.length }), {
          minLength: 0,
          maxLength: 40,
        }),
        (cuts) => {
          const points = Array.from(new Set(cuts)).sort((a, b) => a - b);
          const chunks = [];
          let prev = 0;
          for (const p of points) {
            chunks.push(fixtureXml.slice(prev, p));
            prev = p;
          }
          chunks.push(fixtureXml.slice(prev));
          const rows = core.parseXmlChunks(chunks, "all");
          expect(rows).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});
