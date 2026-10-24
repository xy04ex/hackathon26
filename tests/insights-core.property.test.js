// Property-based tests for js/insights-core.js (fast-check + vitest).
// Each property maps to the requirements' Correctness Properties.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "insights-core.js"));
const RUNS = { numRuns: 100 };

// Build a run of consecutive-day rows from arrays of nullable metrics.
function rowsFrom(days) {
  const start = Date.UTC(2023, 0, 1) / 86400000;
  return days.map((d, i) => ({
    date: new Date((start + i) * 86400000).toISOString().slice(0, 10),
    hrv: d.hrv, rhr: d.rhr, resp: null, sleep_h: d.sleep,
  }));
}
const metric = (min, max) => fc.oneof(fc.constant(null), fc.double({ min, max, noNaN: true, noDefaultInfinity: true }));
const dayArb = fc.record({ hrv: metric(20, 120), rhr: metric(45, 90), sleep: metric(3, 11) });
const daysArb = fc.array(dayArb, { minLength: 0, maxLength: 80 });

describe("insights-core properties", () => {
  // Property 2: Determinism — same dataset + seed -> identical output.
  it("Property 2: deterministic", () => {
    fc.assert(fc.property(daysArb, (days) => {
      const rows = rowsFrom(days);
      const a = JSON.stringify(core.computeInsights(rows, { seed: core.SEED }));
      const b = JSON.stringify(core.computeInsights(rows, { seed: core.SEED }));
      expect(a).toBe(b);
    }), RUNS);
  });

  // Property 3/4: baseline uses only prior 30 days excluding self; few-history
  // days have no adjusted HRV.
  it("Property 3/4: rolling mean excludes self, needs >= MIN_BASELINE_HISTORY", () => {
    fc.assert(fc.property(daysArb, (days) => {
      const rows = rowsFrom(days);
      const adj = core.baselineAdjustedByDate(rows);
      const byDate = {}; rows.forEach((r) => (byDate[r.date] = r));
      Object.keys(adj).forEach((date) => {
        const ord = Date.UTC(...date.split("-").map((v, i) => (i === 1 ? +v - 1 : +v))) / 86400000;
        // recompute prior window
        let prior = [];
        rows.forEach((r) => {
          const o = Date.UTC(...r.date.split("-").map((v, i) => (i === 1 ? +v - 1 : +v))) / 86400000;
          if (typeof r.hrv === "number" && o < ord && o >= ord - core.BASELINE_DAYS) prior.push(r.hrv);
        });
        expect(prior.length).toBeGreaterThanOrEqual(core.MIN_BASELINE_HISTORY);
        // adjusted = hrv - mean(prior); mean(prior) does not involve self
        const expected = byDate[date].hrv - core.mean(prior);
        expect(Math.abs(adj[date] - expected)).toBeLessThan(1e-9);
      });
    }), RUNS);
  });

  // Property 5: pairs consecutive, both present, labeled by morning date.
  it("Property 5: pairing correctness", () => {
    fc.assert(fc.property(daysArb, (days) => {
      const rows = rowsFrom(days);
      const adj = core.baselineAdjustedByDate(rows);
      const byDate = {}; rows.forEach((r) => (byDate[r.date] = r));
      const pairs = core.buildPairs(rows);
      pairs.forEach((p) => {
        const mornOrd = Date.UTC(...p.date.split("-").map((v, i) => (i === 1 ? +v - 1 : +v))) / 86400000;
        const prevIso = new Date((mornOrd - 1) * 86400000).toISOString().slice(0, 10);
        expect(p.date in adj).toBe(true);           // morning has adjusted HRV
        expect(typeof byDate[prevIso].sleep_h).toBe("number"); // prev night present
        expect(p.sleep).toBe(byDate[prevIso].sleep_h);
      });
    }), RUNS);
  });

  // Property 11: short-sleep share in [0,1], only over present nights, and
  // adding a 7h+ night never increases it.
  it("Property 11: short-sleep share bounds + monotonicity", () => {
    fc.assert(fc.property(daysArb, (days) => {
      const rows = rowsFrom(days);
      const ss = core.shortSleepShare(rows);
      if (ss) {
        expect(ss.share).toBeGreaterThanOrEqual(0);
        expect(ss.share).toBeLessThanOrEqual(1);
        const rows2 = rows.concat([{ date: "2099-01-01", hrv: null, rhr: null, resp: null, sleep_h: 8 }]);
        const ss2 = core.shortSleepShare(rows2);
        expect(ss2.share).toBeLessThanOrEqual(ss.share + 1e-9);
      }
    }), RUNS);
  });

  // Property 10: no HRV-population-norm comparison in the reference output.
  it("Property 10: reference never compares HRV to norms", () => {
    fc.assert(fc.property(daysArb, (days) => {
      const out = core.computeInsights(rowsFrom(days), { seed: core.SEED });
      expect(out.reference.hrv_norm_comparison).toBe(false);
      // no numeric hrv range/threshold field on the reference
      expect(out.reference).not.toHaveProperty("hrv_range");
      expect(out.reference).not.toHaveProperty("hrv_norm");
    }), RUNS);
  });

  // Stats helpers: Pearson r in [-1,1]; RMSE >= 0 and 0 on exact fit.
  it("Property (stats): pearson r in [-1,1]; rmse>=0, 0 on exact", () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
                        fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true })),
               { minLength: 2, maxLength: 40 }),
      (pts) => {
        const x = pts.map((p) => p[0]); const y = pts.map((p) => p[1]);
        const r = core.pearsonR(x, y);
        if (!Number.isNaN(r)) { expect(r).toBeGreaterThanOrEqual(-1 - 1e-9); expect(r).toBeLessThanOrEqual(1 + 1e-9); }
        expect(core.rmse(y, y)).toBeLessThan(1e-9); // exact fit
      }
    ), RUNS);
  });
});
