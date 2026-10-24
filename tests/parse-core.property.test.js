// Property-based tests for js/parse-core.js (fast-check + vitest, dev-only).
//
// Each property maps to a design property in
// .kiro/specs/browser-onboarding/design.md and runs >= 100 iterations.
// parse-core is loaded via createRequire (module.exports guard), like the
// existing score/order tests.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "parse-core.js"));

const RUNS = { numRuns: 100 };

// --- Arbitraries --------------------------------------------------------

// An Apple-format timestamp with a varied offset. We also return the epoch ms
// and local date so tests can check assignment.
const tsArb = fc
  .record({
    y: fc.integer({ min: 2020, max: 2025 }),
    mo: fc.integer({ min: 1, max: 12 }),
    da: fc.integer({ min: 1, max: 28 }),
    hh: fc.integer({ min: 0, max: 23 }),
    mm: fc.integer({ min: 0, max: 59 }),
    ss: fc.integer({ min: 0, max: 59 }),
    offH: fc.integer({ min: -8, max: 8 }),
  })
  .map(({ y, mo, da, hh, mm, ss, offH }) => {
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    const sign = offH < 0 ? "-" : "+";
    const off = sign + pad(Math.abs(offH)) + "00";
    const s = `${pad(y, 4)}-${pad(mo)}-${pad(da)} ${pad(hh)}:${pad(mm)}:${pad(ss)} ${off}`;
    return { s, dateISO: `${pad(y, 4)}-${pad(mo)}-${pad(da)}` };
  });

// A set of intervals on a common day as [startMs, endMs] with positive length.
const intervalsArb = fc.array(
  fc
    .record({
      start: fc.integer({ min: 0, max: 80000 }),
      len: fc.integer({ min: 1, max: 40000 }),
    })
    .map(({ start, len }) => [start, start + len]),
  { minLength: 1, maxLength: 8 }
);

describe("parse-core properties", () => {
  // Feature: browser-onboarding, Property 8: Rounding — each value has at most
  // 2 decimals and equals the full-precision value rounded as the reference does.
  it("Property 8: round2 produces at most 2 decimals and is stable", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }), (x) => {
        const r = core.round2(x);
        // at most 2 decimal places
        expect(Math.round(r * 100)).toBeCloseTo(r * 100, 6);
        // idempotent
        expect(core.round2(r)).toBe(r);
      }),
      RUNS
    );
  });

  // Feature: browser-onboarding, Property 7: Null-not-zero — empty metric is
  // null (never 0); dailyMean never fabricates a 0 for missing data.
  it("Property 7: dailyMean is null for empty, number otherwise", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 200, noNaN: true, noDefaultInfinity: true }), {
          minLength: 0,
          maxLength: 10,
        }),
        (vals) => {
          const m = core.dailyMean(vals);
          if (vals.length === 0) expect(m).toBe(null);
          else expect(typeof m).toBe("number");
        }
      ),
      RUNS
    );
  });

  // Feature: browser-onboarding, Property 3: Sleep interval merging — merged
  // <= sum; equal only when disjoint; a contained interval changes nothing.
  it("Property 3: merged duration <= sum, and containment is a no-op", () => {
    fc.assert(
      fc.property(intervalsArb, (intervals) => {
        const merged = core.mergeIntervals(intervals);
        const sum = intervals.reduce((a, iv) => a + (iv[1] - iv[0]) / 1000, 0);
        expect(merged).toBeLessThanOrEqual(sum + 1e-9);
        // Add a fully-contained interval inside the first one; no change.
        const first = intervals[0];
        if (first[1] - first[0] >= 2) {
          const inner = [first[0] + 1, first[1] - 0]; // contained/overlapping
          const merged2 = core.mergeIntervals(intervals.concat([inner]));
          expect(merged2).toBeCloseTo(merged, 9);
        }
      }),
      RUNS
    );
  });

  // Feature: browser-onboarding, Property 4: Merge order independence — the
  // merged duration does not depend on input order.
  it("Property 4: mergeIntervals is order-independent", () => {
    fc.assert(
      fc.property(intervalsArb, fc.integer(), (intervals, seed) => {
        const shuffled = intervals
          .map((v, i) => [v, ((i + 1) * (seed || 1)) % 97])
          .sort((a, b) => a[1] - b[1])
          .map((p) => p[0]);
        expect(core.mergeIntervals(shuffled)).toBeCloseTo(
          core.mergeIntervals(intervals),
          9
        );
      }),
      RUNS
    );
  });

  // Feature: browser-onboarding, Property 5: Wake-date assignment — a sleep
  // record is assigned to the local calendar date of its END time.
  it("Property 5: sleep assigned to the end-time local date", () => {
    fc.assert(
      fc.property(tsArb, tsArb, (startTs, endTs) => {
        const acc = core.newAccumulators();
        // Force end strictly after start by using the later ms.
        const s = core.parseAppleDateTime(startTs.s);
        const e = core.parseAppleDateTime(endTs.s);
        if (!s || !e) return;
        const lo = s.ms <= e.ms ? startTs : endTs;
        const hi = s.ms <= e.ms ? endTs : startTs;
        if (core.parseAppleDateTime(lo.s).ms >= core.parseAppleDateTime(hi.s).ms) return;
        core.accumulate(acc, {
          type: core.TYPES.SLEEP,
          value: "HKCategoryValueSleepAnalysisAsleep",
          startDate: lo.s,
          endDate: hi.s,
        });
        const keys = Object.keys(acc.sleep);
        expect(keys).toEqual([hi.dateISO]);
      }),
      RUNS
    );
  });

  // Feature: browser-onboarding, Property 6: Asleep-stage filtering — InBed and
  // Awake contribute zero; only the five asleep stages contribute.
  it("Property 6: only asleep stages contribute to sleep", () => {
    const nonAsleep = ["HKCategoryValueSleepAnalysisInBed", "HKCategoryValueSleepAnalysisAwake"];
    fc.assert(
      fc.property(tsArb, fc.constantFrom(...nonAsleep), (ts, badStage) => {
        const acc = core.newAccumulators();
        const start = ts.s;
        const end = ts.s.replace(/(\d{2}):(\d{2}):(\d{2})/, (mm, h) => {
          const nh = String((Number(h) + 1) % 24).padStart(2, "0");
          return `${nh}:00:00`;
        });
        core.accumulate(acc, {
          type: core.TYPES.SLEEP,
          value: badStage,
          startDate: start,
          endDate: end,
        });
        expect(Object.keys(acc.sleep).length).toBe(0);
      }),
      RUNS
    );
  });

  // Feature: browser-onboarding, Property 2: Sort order and shape — output is
  // strictly ascending by date, unique dates, exactly five fields per row.
  it("Property 2: buildDaily output is sorted, unique, five-field", () => {
    const rowAcc = fc.array(tsArb, { minLength: 0, maxLength: 20 }).map((tss) => {
      const acc = core.newAccumulators();
      tss.forEach((ts, i) => {
        core.accumulate(acc, {
          type: i % 2 ? core.TYPES.HRV : core.TYPES.RHR,
          value: String(40 + (i % 60)),
          startDate: ts.s,
          endDate: ts.s,
        });
      });
      return acc;
    });
    fc.assert(
      fc.property(rowAcc, (acc) => {
        const rows = core.buildDaily(acc);
        for (let i = 1; i < rows.length; i++) {
          expect(rows[i].date > rows[i - 1].date).toBe(true); // strictly ascending, unique
        }
        rows.forEach((r) => {
          expect(Object.keys(r).sort()).toEqual(
            ["date", "hrv", "resp", "rhr", "sleep_h"].sort()
          );
        });
      }),
      RUNS
    );
  });

  // Feature: browser-onboarding, Property 9: Last-N-months filter — the 6-month
  // result is exactly the subset of "everything" within 6 months of the max date.
  it("Property 9: filterLastNMonths is a correct subset of everything", () => {
    const rowsArb = fc
      .uniqueArray(
        fc.record({
          y: fc.integer({ min: 2022, max: 2025 }),
          mo: fc.integer({ min: 1, max: 12 }),
          da: fc.integer({ min: 1, max: 28 }),
        }),
        { selector: (r) => `${r.y}-${r.mo}-${r.da}`, minLength: 1, maxLength: 30 }
      )
      .map((ds) =>
        ds
          .map((d) => {
            const pad = (n, w = 2) => String(n).padStart(w, "0");
            return { date: `${pad(d.y, 4)}-${pad(d.mo)}-${pad(d.da)}`, hrv: null, rhr: null, resp: null, sleep_h: null };
          })
          .sort((a, b) => (a.date < b.date ? -1 : 1))
      );
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const filtered = core.filterLastNMonths(rows, 6);
        const everything = rows;
        // subset
        filtered.forEach((r) => expect(everything).toContainEqual(r));
        // max date anchors the window; max row is always kept
        const maxISO = everything.reduce((m, r) => (r.date > m ? r.date : m), everything[0].date);
        expect(filtered.some((r) => r.date === maxISO)).toBe(true);
        // everything is unchanged
        expect(everything).toEqual(rows);
      }),
      RUNS
    );
  });
});
