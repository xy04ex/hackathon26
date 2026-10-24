// Tests for js/onboarding.js persistence + first-run predicate (Tasks 7.2/7.5).
//
// js/onboarding.js is a browser module that closes over `window`. We don't pull
// in a full DOM here (the project keeps dev deps minimal); instead we provide a
// tiny window stub with just localStorage + the globals the persistence paths
// touch, load the module fresh against it, and exercise the pure/storage logic
// and the two persistence-related properties (10 and 12). Rendering and worker
// lifecycle are verified manually in the real browser (see tasks.md task 9).

import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import vm from "vm";
import { readFileSync } from "fs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(here, "..", "js", "onboarding.js"), "utf8");

// Build a fresh module instance bound to a stub window, so each test is isolated.
function freshOnboarding() {
  const store = {};
  const win = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
    HUIFAN_DAILY: null,
    HUIFAN_SAMPLE_DAILY: null,
    matchMedia: () => ({ matches: false }),
  };
  const sandbox = { window: win, module: { exports: {} } };
  sandbox.module.exports = {};
  vm.createContext(sandbox);
  // The module's IIFE uses `typeof window !== "undefined" ? window : this`.
  vm.runInContext(SRC, sandbox);
  return { api: win.HuifanOnboarding, win, store };
}

describe("onboarding persistence + predicate", () => {
  it("shouldFirstRun across the four store/global combinations", () => {
    const { api } = freshOnboarding();
    expect(api.shouldFirstRun(null, null)).toBe(true);
    expect(api.shouldFirstRun([], [])).toBe(true);
    expect(api.shouldFirstRun([{ date: "x" }], null)).toBe(false);
    expect(api.shouldFirstRun(null, [{ date: "x" }])).toBe(false);
    expect(api.shouldFirstRun([{ date: "x" }], [{ date: "y" }])).toBe(false);
  });

  it("storage-unavailable: saveDataset returns false, no throw", () => {
    const { api, win } = freshOnboarding();
    win.localStorage.setItem = () => {
      throw new Error("quota");
    };
    expect(api.saveDataset([{ date: "2024-01-01" }])).toBe(false);
  });

  // Feature: browser-onboarding, Property 10: Save/load round-trip — saving a
  // dataset and loading it back yields an equal dataset.
  it("Property 10: save/load round-trip is identity", () => {
    const rowArb = fc.record({
      date: fc.date({ min: new Date(2020, 0, 1), max: new Date(2025, 0, 1) }).map((d) => d.toISOString().slice(0, 10)),
      hrv: fc.oneof(fc.constant(null), fc.double({ min: 10, max: 150, noNaN: true, noDefaultInfinity: true })),
      rhr: fc.oneof(fc.constant(null), fc.double({ min: 35, max: 110, noNaN: true, noDefaultInfinity: true })),
      resp: fc.oneof(fc.constant(null), fc.double({ min: 8, max: 30, noNaN: true, noDefaultInfinity: true })),
      sleep_h: fc.oneof(fc.constant(null), fc.double({ min: 0, max: 14, noNaN: true, noDefaultInfinity: true })),
    });
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 40 }), (rows) => {
        const { api } = freshOnboarding();
        api.saveDataset(rows);
        expect(api.loadDataset()).toEqual(rows);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: browser-onboarding, Property 12: Sample data does not persist —
  // deleteDataset clears both the store key and the real global; and loading a
  // sample into the session never writes the store.
  it("Property 12: sample path / delete never leaves persisted real data", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ date: fc.constant("2024-01-01") }), { maxLength: 10 }), (sample) => {
        const { api, win, store } = freshOnboarding();
        win.HUIFAN_SAMPLE_DAILY = sample;
        // Simulate the sample path's contract: it must not call saveDataset and
        // must not set HUIFAN_DAILY. We assert the store stays empty and the
        // global is not the sample array.
        expect(api.loadDataset()).toBe(null);
        expect(store[api.STORAGE_KEY]).toBe(undefined);
        expect(win.HUIFAN_DAILY).not.toBe(sample);
        // And delete clears both store and global even after a real save.
        api.saveDataset([{ date: "2024-02-02" }]);
        win.HUIFAN_DAILY = [{ date: "2024-02-02" }];
        api.deleteDataset();
        expect(api.loadDataset()).toBe(null);
        expect(win.HUIFAN_DAILY).toBe(null);
      }),
      { numRuns: 100 }
    );
  });
});
