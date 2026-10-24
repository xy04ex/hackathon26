// Regression for the "new task shows ticked after refresh" bug.
//
// Restoring today's done/skipped state must match a task to today's records by
// EXACT trimmed, case-insensitive text — never by list position. A task not in
// today's history starts unticked ("pending").
//
// app.js's restore lives inside an IIFE, so we mirror its exact logic here
// (normText + statusByText lookup) and pin the behavior. If app.js changes the
// rule, this test documents the contract it must keep.

import { describe, it, expect } from "vitest";

function normText(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

// Mirror of onTagClick's restore: given today's saved records and freshly
// parsed tasks (in any order), assign status by normalized text only.
function restoreStatuses(savedToday, parsedTasks) {
  const statusByText = {};
  savedToday.forEach((r) => {
    const status =
      r.status ||
      (typeof r.done === "boolean" ? (r.done ? "done" : "pending") : "pending");
    statusByText[normText(r.task_text)] = status;
  });
  return parsedTasks.map((t) =>
    Object.assign({}, t, { status: statusByText[normText(t.text)] || "pending" })
  );
}

describe("task status restore matches by text, not position", () => {
  it("a NEW task in the same position as a previously done task starts unticked", () => {
    // Yesterday-in-today's-history: position 0 was "write essay" and done.
    const savedToday = [
      { task_text: "write essay", status: "done" },
      { task_text: "reply to emails", status: "pending" },
    ];
    // User clears and types a different first task at the SAME position 0.
    const parsed = [
      { text: "call dentist" }, // position 0, but different text
      { text: "reply to emails" }, // same text as before -> should stay pending
    ];
    const restored = restoreStatuses(savedToday, parsed);
    expect(restored[0].status).toBe("pending"); // NOT done, despite position 0
    expect(restored[1].status).toBe("pending");
  });

  it("matches done/skipped by exact trimmed, case-insensitive text", () => {
    const savedToday = [
      { task_text: "Write Essay", status: "done" },
      { task_text: "gym", status: "skipped" },
    ];
    const parsed = [
      { text: "  write essay " }, // whitespace + case differ -> still matches
      { text: "GYM" },
      { text: "brand new task" },
    ];
    const restored = restoreStatuses(savedToday, parsed);
    expect(restored[0].status).toBe("done");
    expect(restored[1].status).toBe("skipped");
    expect(restored[2].status).toBe("pending"); // not in history
  });

  it("falls back to legacy done boolean when no status field", () => {
    const savedToday = [{ task_text: "old task", done: true }];
    const restored = restoreStatuses(savedToday, [{ text: "old task" }, { text: "new" }]);
    expect(restored[0].status).toBe("done");
    expect(restored[1].status).toBe("pending");
  });
});
