// Property tests for js/patterns-core.js and the real-data demotion guarantee.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "patterns-core.js"));
const RUNS = { numRuns: 60 };

const TYPES = ["deep work", "reading", "admin"];
const TIERS = ["green", "yellow", "red"];
const recArb = fc.record({
  type: fc.constantFrom(...TYPES),
  tier: fc.constantFrom(...TIERS),
  done: fc.boolean(),
});
const logsArb = fc.array(recArb, { minLength: 0, maxLength: 120 });

describe("patterns-core properties", () => {
  // Property 2: determinism — same logs -> identical output (no RNG).
  it("deterministic", () => {
    fc.assert(fc.property(logsArb, (logs) => {
      expect(JSON.stringify(core.analyze(logs))).toBe(JSON.stringify(core.analyze(logs)));
    }), RUNS);
  });

  // Property 4: interval validity.
  // Property 4: interval validity for EVERY cell, including empty cells and a
  // 0%/100% overall completion rate. The prior mean is clamped to [0.01, 0.99]
  // so the posterior is always proper, so estimate is always within its CI.
  it("every cell has 0<=ci_low<=estimate<=ci_high<=1", () => {
    fc.assert(fc.property(logsArb, (logs) => {
      const a = core.analyze(logs);
      Object.values(a.types).forEach((t) => TIERS.forEach((tier) => {
        const c = t.tiers[tier];
        expect(c.ci_low).toBeGreaterThanOrEqual(0);
        expect(c.ci_low).toBeLessThanOrEqual(c.estimate + 1e-6);
        expect(c.estimate).toBeLessThanOrEqual(c.ci_high + 1e-6);
        expect(c.ci_high).toBeLessThanOrEqual(1);
      }));
    }), RUNS);
  });

  // The specific regression: a 100% (or 0%) overall rate must still give a
  // proper posterior for empty cells (estimate within the interval).
  it("100% and 0% overall rate keep empty-cell intervals proper", () => {
    [true, false].forEach((allDone) => {
      // Only green cells have data; yellow/red are empty.
      const logs = [];
      for (let i = 0; i < 20; i++) logs.push({ type: "deep work", tier: "green", done: allDone });
      const a = core.analyze(logs);
      TIERS.forEach((tier) => {
        const c = a.types["deep work"].tiers[tier];
        expect(c.ci_low).toBeLessThanOrEqual(c.estimate + 1e-6);
        expect(c.estimate).toBeLessThanOrEqual(c.ci_high + 1e-6);
        expect(c.ci_low).toBeGreaterThanOrEqual(0);
        expect(c.ci_high).toBeLessThanOrEqual(1);
      });
    });
  });

  // Property 5: drops monotonic in separation — a type whose green is all done
  // and red all not-done drops; a type with equal rates does not.
  it("clear green>red separation drops; equal rates do not", () => {
    // deep work: green always done, red always not -> should drop.
    const logs = [];
    for (let i = 0; i < 40; i++) {
      logs.push({ type: "deep work", tier: "green", done: true });
      logs.push({ type: "deep work", tier: "red", done: false });
      logs.push({ type: "reading", tier: "green", done: i % 2 === 0 });
      logs.push({ type: "reading", tier: "red", done: i % 2 === 0 });
    }
    const a = core.analyze(logs);
    expect(a.types["deep work"].drops_on_low).toBe(true);
    expect(a.types["reading"].drops_on_low).toBe(false);
  });

  // recordsFromHistory ignores rows without a usable tier/done.
  it("recordsFromHistory keeps only usable rows", () => {
    const history = {
      "2024-01-01": [
        { type: "deep work", tier: "green", done: true },
        { type: "admin", tier: null, done: true },      // no tier -> skip
        { type: "reading", tier: "red" },                // no done -> skip
      ],
      "2024-01-02": "not an array",
    };
    const recs = core.recordsFromHistory(history);
    expect(recs).toEqual([{ type: "deep work", tier: "green", done: true }]);
  });
});
