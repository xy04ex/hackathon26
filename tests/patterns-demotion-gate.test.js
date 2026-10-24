// The real-data demotion gate: learnedDemotions for real/local data come ONLY
// from the user's own in-browser analysis, and only at/above the min-days gate.
// This mirrors app.js loadLearnedDemotions (kept in sync here).

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, "..", "js", "patterns-core.js"));

const PATTERNS_MIN_DAYS = 14;

// Mirror of app.js loadLearnedDemotions (sample path omitted here).
function realLearnedDemotions(history) {
  const loggedDays = Object.keys(history).filter(
    (d) => Array.isArray(history[d]) && history[d].length > 0
  ).length;
  if (loggedDays < PATTERNS_MIN_DAYS) return [];
  const records = core.recordsFromHistory(history);
  if (records.length === 0) return [];
  return core.demotableTypes(core.analyze(records));
}

describe("real-data demotion gate", () => {
  it("too few logged days -> no demotions even with a strong pattern", () => {
    // 5 days, each with deep work done on green and not-done on red: a strong
    // pattern, but below the 14-day gate, so nothing is demoted.
    const history = {};
    for (let i = 1; i <= 5; i++) {
      history["2024-01-0" + i] = [
        { type: "deep work", tier: "green", done: true },
        { type: "deep work", tier: "red", done: false },
      ];
    }
    expect(realLearnedDemotions(history)).toEqual([]);
  });

  it("no logs at all -> no demotions", () => {
    expect(realLearnedDemotions({})).toEqual([]);
  });

  it("enough days with a strong planted pattern -> that type demotes", () => {
    const history = {};
    for (let i = 1; i <= 20; i++) {
      const d = "2024-02-" + String(i).padStart(2, "0");
      history[d] = [
        { type: "deep work", tier: "green", done: true },
        { type: "deep work", tier: "red", done: false },
        { type: "reading", tier: "green", done: i % 2 === 0 },
        { type: "reading", tier: "red", done: i % 2 === 0 },
      ];
    }
    const dem = realLearnedDemotions(history);
    expect(dem).toContain("deep work");
    expect(dem).not.toContain("reading");
  });
});
