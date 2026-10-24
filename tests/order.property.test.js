// Property-based tests for js/order.js (fast-check + vitest).
//
// Properties checked:
//   - Reorder never adds, removes, or renames tasks: the output is a
//     permutation of the input (same multiset of ids and texts, same count).
//   - Tasks due today always appear before any task not due today.
//   - A low recovery band with low HRV but NO proven learned demotions never
//     changes the order (HRV alone must never reorder).
//   - Ties are stable: when no rule applies, original order is preserved.

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

// An arbitrary task. ids are assigned after generation to be unique.
const taskArb = fc.record({
  text: fc.string({ minLength: 1, maxLength: 20 }),
  type: fc.constantFrom(...TYPES),
  effort: fc.integer({ min: 1, max: 3 }),
  due: fc.constantFrom(...DUES),
});

const tasksArb = fc
  .array(taskArb, { minLength: 0, maxLength: 12 })
  .map((arr) => arr.map((t, i) => Object.assign({ id: i + 1 }, t)));

const ctxArb = fc.record({
  sleepHours: fc.oneof(
    fc.constant(null),
    fc.double({ min: 0, max: 14, noNaN: true, noDefaultInfinity: true })
  ),
  band: fc.constantFrom("green", "yellow", "red", null),
  learnedDemotions: fc.subarray(TYPES),
});

function ids(list) {
  return list.map((t) => t.id);
}
function sortedIds(list) {
  return ids(list).slice().sort((a, b) => a - b);
}

describe("reorder properties", () => {
  it("output is a permutation of the input (never add/remove/rename)", () => {
    fc.assert(
      fc.property(tasksArb, ctxArb, (tasks, ctx) => {
        const { ordered } = reorderTasks(tasks, ctx);
        // Same count.
        expect(ordered.length).toBe(tasks.length);
        // Same set of ids.
        expect(sortedIds(ordered)).toEqual(sortedIds(tasks));
        // Texts are never renamed: each id keeps its original text.
        const textById = new Map(tasks.map((t) => [t.id, t.text]));
        for (const t of ordered) {
          expect(t.text).toBe(textById.get(t.id));
        }
      })
    );
  });

  it("tasks due today come before any task not due today", () => {
    fc.assert(
      fc.property(tasksArb, ctxArb, (tasks, ctx) => {
        const { ordered } = reorderTasks(tasks, ctx);
        let seenNonToday = false;
        for (const t of ordered) {
          if (t.due === "today") {
            // A today task must not appear after a non-today task.
            expect(seenNonToday).toBe(false);
          } else {
            seenNonToday = true;
          }
        }
      })
    );
  });

  it("low band + low HRV but no learned demotions never changes order", () => {
    // HRV is not even an input to reorder, so a red band with empty
    // learnedDemotions and adequate sleep must preserve original order.
    const tasksNoDue = tasksArb.map((arr) =>
      arr.map((t) => Object.assign({}, t, { due: "later" }))
    );
    fc.assert(
      fc.property(tasksNoDue, (tasks) => {
        const { ordered } = reorderTasks(tasks, {
          sleepHours: 8, // not short -> no short-sleep rule
          band: "red", // low day
          learnedDemotions: [], // no proven pattern
        });
        expect(ids(ordered)).toEqual(ids(tasks));
      })
    );
  });

  it("ties are stable: no applicable rule preserves original order", () => {
    // All tasks due 'later', normal sleep, green band, no demotions -> the
    // reorder has nothing to act on and must return the original order.
    const tasksNoDue = tasksArb.map((arr) =>
      arr.map((t) => Object.assign({}, t, { due: "later" }))
    );
    fc.assert(
      fc.property(tasksNoDue, (tasks) => {
        const { ordered } = reorderTasks(tasks, {
          sleepHours: 7.5,
          band: "green",
          learnedDemotions: [],
        });
        expect(ids(ordered)).toEqual(ids(tasks));
      })
    );
  });
});
