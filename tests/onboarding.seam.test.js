// Data-source seam integration test (Task 8.3).
//
// Verifies the contract app.js relies on without pulling in a DOM:
//   - After onboarding.saveDataset(rows) + setting the global, the bootstrap
//     hydration logic in index.html yields window.HUIFAN_DAILY = rows, which is
//     exactly what app.js's pickDataSource() prefers (returns source "real").
//   - A dataset with < 7 usable baseline days makes score.js return the
//     "still learning your baseline" outcome (ok:false), so onboarding does not
//     block and the app keeps that state (Requirements 8.1, 8.2).

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";
import vm from "vm";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const score = require(path.join(here, "..", "js", "score.js"));
const ONB = readFileSync(path.join(here, "..", "js", "onboarding.js"), "utf8");

function freshOnboarding() {
  const store = {};
  const win = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => delete store[k],
    },
    HUIFAN_DAILY: null,
    HUIFAN_SAMPLE_DAILY: null,
    matchMedia: () => ({ matches: false }),
  };
  const sandbox = { window: win, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(ONB, sandbox);
  return { api: win.HuifanOnboarding, win, store };
}

// The exact bootstrap hydration logic inlined in index.html.
function bootstrapHydrate(win) {
  try {
    const raw = win.localStorage.getItem("huifan.daily.v1");
    if (raw) {
      const rows = JSON.parse(raw);
      if (Array.isArray(rows) && rows.length > 0) win.HUIFAN_DAILY = rows;
    }
  } catch (e) {
    /* ignore */
  }
}

// pickDataSource mirror (app.js preference order).
function pickDataSource(win) {
  const real = win.HUIFAN_DAILY;
  if (Array.isArray(real) && real.length > 0) return { rows: real, source: "real" };
  const sample = win.HUIFAN_SAMPLE_DAILY;
  if (Array.isArray(sample) && sample.length > 0) return { rows: sample, source: "sample" };
  return { rows: [], source: "none" };
}

describe("onboarding ↔ app data-source seam", () => {
  it("saved dataset hydrates on next load and reads as source 'real'", () => {
    const rows = [
      { date: "2024-03-01", hrv: 50, rhr: 58, resp: 14, sleep_h: 8 },
      { date: "2024-03-02", hrv: 52, rhr: 57, resp: 15, sleep_h: 7.5 },
    ];
    const { api, store } = freshOnboarding();
    expect(api.saveDataset(rows)).toBe(true);

    // Simulate a fresh page load: new window, same store, run bootstrap.
    const nextWin = {
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
      },
      HUIFAN_DAILY: null,
      HUIFAN_SAMPLE_DAILY: null,
    };
    bootstrapHydrate(nextWin);
    const picked = pickDataSource(nextWin);
    expect(picked.source).toBe("real");
    expect(picked.rows).toEqual(rows);
  });

  it("a <7-day dataset still completes and score stays 'still learning'", () => {
    // Three days: not enough baseline history for the z-scored metrics.
    const rows = [
      { date: "2024-03-01", hrv: 50, rhr: 58, resp: 14, sleep_h: 8 },
      { date: "2024-03-02", hrv: 52, rhr: 57, resp: 15, sleep_h: 7.5 },
      { date: "2024-03-03", hrv: 48, rhr: 60, resp: 14.5, sleep_h: 6.5 },
    ];
    const { api } = freshOnboarding();
    expect(api.saveDataset(rows)).toBe(true); // onboarding does not block
    const r = score.computeRecovery(rows, rows.length - 1);
    expect(r.ok).toBe(false); // "still learning your baseline"
  });
});
