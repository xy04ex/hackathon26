// Privacy regression: "Delete my data" must remove EVERY huifan.* key, not
// just the health dataset. Previously it left huifan.history.v1 (task log)
// behind while the UI promised it deleted everything.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import vm from "vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(here, "..", "js", "onboarding.js"), "utf8");

// A tiny localStorage stub backed by a plain object, with key()/length so the
// clear-all loop works exactly as in a real browser.
function makeStore(initial) {
  const map = Object.assign({}, initial);
  return {
    get length() { return Object.keys(map).length; },
    key(i) { return Object.keys(map)[i] ?? null; },
    getItem(k) { return k in map ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
    _keys() { return Object.keys(map); },
  };
}

function freshOnboarding(initialStore) {
  const win = {
    localStorage: makeStore(initialStore),
    HUIFAN_DAILY: [{ date: "2024-01-01" }],
    HUIFAN_SAMPLE_CHOSEN: true,
    HUIFAN_SAMPLE_DAILY: null,
    matchMedia: () => ({ matches: false }),
    confirm: () => true,
  };
  const sandbox = { window: win, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { api: win.HuifanOnboarding, win };
}

describe("Delete my data clears every huifan.* key", () => {
  it("removes daily, history, and any other huifan.* key", () => {
    const { api, win } = freshOnboarding({
      "huifan.daily.v1": "[]",
      "huifan.history.v1": "{}",
      "huifan.something.else": "x",
      "unrelated.key": "keep-me",
    });
    api.deleteDataset();
    const remaining = win.localStorage._keys();
    // No huifan.* key survives.
    expect(remaining.filter((k) => k.indexOf("huifan.") === 0)).toEqual([]);
    // Non-huifan keys are left untouched.
    expect(remaining).toContain("unrelated.key");
  });

  it("resets in-memory globals", () => {
    const { api, win } = freshOnboarding({ "huifan.daily.v1": "[]" });
    api.deleteDataset();
    expect(win.HUIFAN_DAILY).toBe(null);
    expect(win.HUIFAN_SAMPLE_CHOSEN).toBe(false);
  });

  it("clearAllHuifanKeys leaves an already-empty store empty", () => {
    const { api, win } = freshOnboarding({});
    api.clearAllHuifanKeys();
    expect(win.localStorage._keys()).toEqual([]);
  });
});
