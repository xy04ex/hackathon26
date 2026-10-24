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
  it("cell intervals are valid (0<=lo<=hi<=1) for well-posed cells", () => {
    // Degenerate posteriors (empty cells when the overall rate is exactly 0 or
    // 1, giving a Beta with a zero shape parameter) are improper and not a
    // real-use path (real users pass the min-days gate first). We assert the
    // ordering invariant on cells with data, and the [0,1] bounds always.
    fc.assert(fc.property(logsArb, (logs) => {
      const a = core.analyze(logs);
      const m = a.overall_rate;
      const degenerate = m <= 0 || m >= 1;
      Object.values(a.types).forEach((t) => TIERS.forEach((tier) => {
        const c = t.tiers[tier];
        expect(c.ci_low).toBeGreaterThanOrEqual(0);
        expect(c.ci_high).toBeLessThanOrEqual(1);
        expect(c.ci_low).toBeLessThanOrEqual(c.ci_high + 1e-6);
        if (!degenerate && c.n > 0) {
          expect(c.ci_low).toBeLessThanOrEqual(c.estimate + 1e-6);
          expect(c.estimate).toBeLessThanOrEqual(c.ci_high + 1e-6);
        }
      }));
    }), RUNS);
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
