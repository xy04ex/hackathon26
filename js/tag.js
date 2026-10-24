// tag.js — keyword task-type tagger (pure functions, no DOM).
//
// Given a task's text, guess its type from keywords. This is the default and
// only tagger for now (no LLM). The user can always override the guess via the
// dropdown in the UI, so the tagger only needs to be a helpful first guess.

// The five task types. Order here is also the dropdown order.
const TASK_TYPES = ["deep work", "reading", "admin", "physical", "social"];

const DEFAULT_TYPE = "admin";

// Keyword -> type. Matched as whole words, case-insensitive. Lists are small
// and readable on purpose; extend freely. First type with a match wins, using
// the priority order below (more cognitively specific types first) so e.g.
// "write report" tags as deep work, not admin.
const KEYWORDS = {
  "deep work": [
    "write",
    "writing",
    "code",
    "coding",
    "program",
    "debug",
    "design",
    "essay",
    "problem",
    "problems",
    "proof",
    "analysis",
    "analyze",
    "thesis",
    "research",
    "study",
    "revise",
    "draft",
    "plan",
    "architecture",
  ],
  reading: [
    "read",
    "reading",
    "chapter",
    "paper",
    "papers",
    "article",
    "textbook",
    "notes",
    "review",
    "lecture",
    "slides",
  ],
  admin: [
    "email",
    "emails",
    "reply",
    "schedule",
    "book",
    "pay",
    "bill",
    "bills",
    "form",
    "forms",
    "submit",
    "register",
    "errand",
    "errands",
    "organize",
    "file",
    "sort",
    "calendar",
    "appointment",
  ],
  physical: [
    "run",
    "running",
    "gym",
    "workout",
    "exercise",
    "walk",
    "yoga",
    "swim",
    "bike",
    "lift",
    "stretch",
    "clean",
    "laundry",
    "groceries",
    "cook",
  ],
  social: [
    "call",
    "meet",
    "meeting",
    "lunch",
    "dinner",
    "coffee",
    "party",
    "hang",
    "friend",
    "friends",
    "family",
    "date",
    "text",
    "visit",
  ],
};

// Priority: when a word matches more than one type, prefer the earlier one.
const TYPE_PRIORITY = ["deep work", "reading", "physical", "social", "admin"];

/**
 * Guess a task type from its text. Pure; returns one of TASK_TYPES.
 * Whole-word, case-insensitive matching. Falls back to DEFAULT_TYPE.
 */
function tagTaskType(text) {
  if (!text) return DEFAULT_TYPE;
  const words = String(text)
    .toLowerCase()
    .split(/[^a-z]+/) // split on non-letters so punctuation doesn't block matches
    .filter(Boolean);
  const wordSet = new Set(words);

  for (const type of TYPE_PRIORITY) {
    const kws = KEYWORDS[type];
    for (const kw of kws) {
      if (wordSet.has(kw)) return type;
    }
  }
  return DEFAULT_TYPE;
}

/**
 * Parse a textarea blob (one task per line) into task objects.
 * Blank lines are ignored. Each task gets a guessed type and default effort 2.
 * Pure; does not touch the DOM or storage.
 *
 * Returns: [{ id, text, type, effort }]
 */
function parseTasks(blob) {
  const lines = String(blob || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map((text, i) => ({
    id: i + 1,
    text,
    type: tagTaskType(text),
    effort: 2, // 1..3, user-editable; 2 = medium default
  }));
}

// Expose for the browser and for Node/JSC tests.
if (typeof window !== "undefined") {
  window.HuifanTag = { TASK_TYPES, DEFAULT_TYPE, tagTaskType, parseTasks };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { TASK_TYPES, DEFAULT_TYPE, tagTaskType, parseTasks };
}
