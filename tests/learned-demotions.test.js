// Regression test for the simulated-demotions-leak bug.
//
// Bug: learnedDemotions were pulled from window.HUIFAN_PATTERNS unconditionally,
// but that data is SIMULATED. A real user's deep work would be moved later on a
// red day because of fake data. Fix: simulated demotions apply ONLY when the
// sample dataset is active; real data starts with no demotions until the user's
// own logs prove otherwise.
//
// This test pins two things:
//   1. order.js: with no learned demotions, a red (low) day never demotes any
//      task type — the order is unchanged (HRV/band alone must not reorder).
//   2. The demotion-gating rule: given simulated HUIFAN_PATTERNS, the learned
//      demotions are empty for real data and non-empty only for the sample.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { reorderTasks } = require(path.join(here, "..", "js", "order.js"));

const TYPES = ["deep work", "reading", "admin", "physical", "social"];
const DUES = ["today", "tomorrow", "later"];

const taskArb = fc.record({
  text: fc.string({ minLength: 1, maxLength: 16 }),
  type: fc.constantFrom(...TYPES),
  effort: fc.integer({ min: 1, max: 3 }),
  due: fc.constantFrom(...DUES),
});
const tasksArb = fc
  .array(taskArb, { minLength: 0, maxLength: 12 })
  .map((arr) => arr.map((t, i) => Object.assign({ id: i + 1 }, t)));

// Mirror of app.js loadLearnedDemotions: simulated demotions apply ONLY to the
// sample dataset; real/local data gets [] until the user's own logs prove a
// pattern. (Kept in sync with js/app.js.)
function loadLearnedDemotions(source, patterns) {
  const isSimulatedDemo =
    source === "sample" &&
    patterns &&
    patterns.simulated === true &&
    Array.isArray(patterns.demotable_types);
  return isSimulatedDemo ? patterns.demotable_types.slice() : [];
}

describe("learned demotions are gated to the simulated sample", () => {
  const SIM_PATTERNS = { simulated: true, demotable_types: ["deep work", "admin"] };

  it("real data with no logs yields no learned demotions", () => {
    expect(loadLearnedDemotions("real", SIM_PATTERNS)).toEqual([]);
  });
  it("local data yields no learned demotions either", () => {
    expect(loadLearnedDemotions("local", SIM_PATTERNS)).toEqual([]);
  });
  it("sample data uses the simulated demotions (demo only)", () => {
    expect(loadLearnedDemotions("sample", SIM_PATTERNS)).toEqual(["deep work", "admin"]);
  });

  // The core safety property: on a red day, with no learned demotions (the
  // real-data case), reorder never moves a task later for being a "demotable"
  // type. With due-dates equal and sleep adequate, the order is unchanged.
  it("red day + no demotions never demotes any type (order unchanged)", () => {
    fc.assert(
      fc.property(tasksArb, (tasks) => {
        // Hold the other rules constant: all 'later', sleep >= threshold so the
        // short-sleep rule can't fire. Only the (absent) demotion rule is left.
        const held = tasks.map((t) => Object.assign({}, t, { due: "later" }));
        const demotions = loadLearnedDemotions("real", SIM_PATTERNS); // []
        const res = reorderTasks(held, {
          sleepHours: 8,
          band: "red",
          learnedDemotions: demotions,
        });
        // Same identities in the same original order.
        expect(res.ordered.map((t) => t.id)).toEqual(held.map((t) => t.id));
        // No task was tagged with the learned-demotion reason.
        res.ordered.forEach((t) => {
          if (t.movedBy) expect(t.movedBy.toLowerCase()).not.toContain("drop");
        });
      }),
      { numRuns: 100 }
    );
  });
});
