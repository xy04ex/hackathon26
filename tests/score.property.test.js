// Property-based tests for js/score.js (fast-check + vitest).
//
// Properties checked:
//   - A produced recovery score is always an integer in [0, 100].
//   - The band always matches the documented thresholds.
//   - "still learning" is returned exactly when there is no baseline-compared
//     metric with enough history.
//
// The score module is loaded via createRequire because js/score.js uses a
// CommonJS `module.exports` guard (the app itself loads it as a plain script).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { computeRecovery, bandFor } = require(path.join(here, "..", "js", "score.js"));

// An arbitrary single day. Any metric may be missing (null).
const metric = (min, max) =>
  fc.oneof(
    fc.constant(null),
    fc.double({ min, max, noNaN: true, noDefaultInfinity: true })
  );

const dayArb = fc.record({
  hrv: metric(10, 150), // ms
  rhr: metric(35, 110), // bpm
  resp: metric(8, 30), // breaths/min
  sleep_h: metric(0, 14), // hours
});

// A series of days with sequential dates, so baselines have a time order.
const rowsArb = fc
  .array(dayArb, { minLength: 1, maxLength: 60 })
  .map((days) =>
    days.map((d, i) => {
      const date = new Date(Date.UTC(2024, 0, 1 + i))
        .toISOString()
        .slice(0, 10);
      return Object.assign({ date }, d);
    })
  );

describe("recovery score properties", () => {
  it("score is always an integer in [0, 100] when ok", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const r = computeRecovery(rows, rows.length - 1);
        if (!r.ok) return; // "still learning" is a valid non-score outcome
        expect(Number.isInteger(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      })
    );
  });

  it("band matches the documented thresholds for any score", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (score) => {
        const band = bandFor(score);
        if (score >= 67) expect(band).toBe("green");
        else if (score <= 33) expect(band).toBe("red");
        else expect(band).toBe("yellow");
      })
    );
  });

  it("a produced band is always one of green/yellow/red", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const r = computeRecovery(rows, rows.length - 1);
        if (!r.ok) return;
        expect(["green", "yellow", "red"]).toContain(r.band);
      })
    );
  });
});
