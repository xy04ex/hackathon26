// Parity gate: js/patterns-core.js must match scripts/patterns.py on the
// simulated logs, field-for-field within 4 dp. Both now use the SAME
// deterministic Beta math (no sampling), so agreement is exact.
//
// Regenerate the expected fixture with:
//   python3 scripts/patterns.py data/simulated-logs.json
//   cp data/patterns.json tests/fixtures/patterns-expected.json

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "patterns-core.js"));

const TIERS = ["green", "yellow", "red"];
function loadLogs() {
  return JSON.parse(readFileSync(path.join(here, "..", "data", "simulated-logs.json"), "utf8"))
    .filter((r) => TIERS.includes(r.tier) && typeof r.done === "boolean");
}

function diffs(a, b, p = "", out = []) {
  if (a && typeof a === "object" && !Array.isArray(a)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b || {})])) diffs(a[k], b ? b[k] : undefined, p + "." + k, out);
  } else if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-9) out.push([p, a, b]);
  } else if (a !== b) out.push([p, a, b]);
  return out;
}

describe("patterns-core parity with scripts/patterns.py (simulated logs)", () => {
  // Feature: browser-patterns, Property 1: parity model-based.
  it("matches patterns-expected.json analysis + demotable_types", () => {
    const logs = loadLogs();
    const a = core.analyze(logs);
    const exp = JSON.parse(readFileSync(path.join(here, "fixtures", "patterns-expected.json"), "utf8"));
    expect(diffs(a.types, exp.analysis.types)).toEqual([]);
    expect(a.overall_rate).toBe(exp.analysis.overall_rate);
    expect(core.demotableTypes(a)).toEqual(exp.demotable_types);
  });

  // Property 4: interval validity per cell.
  it("every cell has 0<=ci_low<=estimate<=ci_high<=1", () => {
    const a = core.analyze(loadLogs());
    Object.values(a.types).forEach((t) => {
      TIERS.forEach((tier) => {
        const c = t.tiers[tier];
        expect(c.ci_low).toBeGreaterThanOrEqual(0);
        expect(c.ci_low).toBeLessThanOrEqual(c.estimate + 1e-9);
        expect(c.estimate).toBeLessThanOrEqual(c.ci_high + 1e-9);
        expect(c.ci_high).toBeLessThanOrEqual(1);
      });
    });
  });
});
