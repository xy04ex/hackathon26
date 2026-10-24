// Parity gate: js/insights-core.js must match scripts/insights.py on the sample.
//
// We compare insights-core's computeInsights(sample) to the committed
// tests/fixtures/sample-insights.json, which is produced by running
// scripts/insights.py on data/sample-daily.json. The PRNG stream fixture pins
// the shared mulberry32 so the bootstrap CI is reproducible cross-language.
//
// Regenerate the expected fixture with:
//   python3 scripts/insights.py data/sample-daily.json
//   cp data/insights.json tests/fixtures/sample-insights.json
//   rm -f data/insights.json data/insights.js   # keep only sample-safe output

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "insights-core.js"));

function loadSampleRows() {
  const js = readFileSync(path.join(here, "..", "data", "sample-daily.js"), "utf8")
    .replace("window.HUIFAN_SAMPLE_DAILY =", "module.exports =")
    .replace(/^\/\/.*$/gm, "");
  const m = { exports: {} };
  new Function("module", js)(m);
  return m.exports;
}
function cdcSuffolk() {
  const cdc = JSON.parse(readFileSync(path.join(here, "..", "data", "cdc-short-sleep-ma.json"), "utf8"));
  const s = cdc.counties.find((c) => c.county === "Suffolk");
  return { county: "Suffolk", pct_short_sleep: s.pct_short_sleep, ci_low: s.ci_low, ci_high: s.ci_high, year: s.year, citation: cdc.citation };
}

// Deep numeric-aware comparison: integer-valued floats (78 vs 78.0) are equal.
function diffs(a, b, p = "", out = []) {
  if (a && typeof a === "object" && !Array.isArray(a) && b && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[k], b[k], p + "." + k, out);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push([p, "len", a.length, b.length]);
    else a.forEach((_, i) => diffs(a[i], b[i], `${p}[${i}]`, out));
  } else if (typeof a === "number" && typeof b === "number") {
    if (Number(a) !== Number(b)) out.push([p, a, b]);
  } else if (a !== b) out.push([p, a, b]);
  return out;
}

describe("insights-core parity with scripts/insights.py (sample)", () => {
  // Feature: browser-insights, Property 1: Parity with the reference.
  it("matches the committed sample-insights.json field-for-field", () => {
    const rows = loadSampleRows();
    const got = core.computeInsights(rows, { seed: core.SEED, cdc: cdcSuffolk() });
    const expected = JSON.parse(readFileSync(path.join(here, "fixtures", "sample-insights.json"), "utf8"));
    const d = diffs(got, expected);
    expect(d).toEqual([]);
  });
});

describe("shared mulberry32 PRNG stream", () => {
  // Feature: browser-insights, Property 8: Bootstrap CI determinism under the
  // shared PRNG — the JS stream matches the committed reference stream (which
  // the Python parity run reproduces exactly).
  it("reproduces the committed 1000-value stream at SEED", () => {
    const ref = JSON.parse(readFileSync(path.join(here, "fixtures", "prng-stream.json"), "utf8"));
    const r = core.makeRng(core.SEED);
    for (let i = 0; i < ref.length; i++) expect(r()).toBe(ref[i]);
  });
});
