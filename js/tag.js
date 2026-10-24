// tag.js — keyword task-type tagger (pure functions, no DOM).
//
// Given a task's text, guess its type from keywords. This is the default and
// only tagger for now (no LLM). The user can always override the guess via the
// dropdown in the UI, so the tagger only needs to be a helpful first guess.

// The five task types. Order here is also the dropdown order.
const TASK_TYPES = ["deep work", "reading", "admin", "physical", "social"];

const DEFAULT_TYPE = "admin";

// Default effort guess per type (1 = quick, 3 = demanding). User-editable.
// Rationale: admin/social are usually quick wins; reading/physical are medium;
// deep work is the demanding one the short-sleep rule should chunk.
const EFFORT_BY_TYPE = {
  "deep work": 3,
  reading: 2,
  physical: 2,
  admin: 1,
  social: 1,
};
const DEFAULT_EFFORT = 2;

/** Guess effort 1..3 from a task's type. Pure. */
function effortForType(type) {
  return EFFORT_BY_TYPE[type] || DEFAULT_EFFORT;
}

// Keyword -> type. Matched as whole words, case-insensitive. Lists are small
// and readable on purpose; extend freely. First type with a match wins, using
// the priority order below (more cognitively specific types first) so e.g.
// "write report" tags as deep work, not admin.
const KEYWORDS = {
  // Multi-word phrases are checked against the whole text; single words are
  // matched as whole words. Order within a type doesn't matter; cross-type
  // ties are broken by TYPE_PRIORITY below.
  "deep work": [
    "worksheet", "postlab", "post lab", "prelab", "pre lab", "lab report",
    "problem set", "pset", "problem sets", "essay", "paper", "code", "coding",
    "program", "debug", "study", "review", "exam", "write", "writing", "proof",
    "analysis", "analyze", "thesis", "research", "revise", "draft", "design",
    "architecture", "homework", "assignment",
  ],
  reading: [
    "read", "reading", "chapter", "article", "articles", "textbook", "lecture",
    "slides", "notes",
  ],
  admin: [
    "email", "emails", "reply", "schedule", "book", "pay", "bill", "bills",
    "form", "forms", "submit", "register", "errand", "errands", "organize",
    "file", "sort", "calendar", "appointment", "admin",
  ],
  physical: [
    "workout", "work out", "gym", "fitrec", "run", "running", "yoga", "swim",
    "swimming", "lift", "lifting", "walk", "walking", "exercise", "bike",
    "biking", "stretch", "hike", "hiking",
  ],
  social: [
    "call", "meet", "meeting", "dinner", "coffee", "text", "lunch", "party",
    "hang", "hangout", "friend", "friends", "family", "date", "visit", "brunch",
  ],
};

// Priority: when a word matches more than one type, prefer the earlier one.
const TYPE_PRIORITY = ["deep work", "reading", "physical", "social", "admin"];

/**
 * Guess a task type from its text. Pure.
 * - Single-word keywords match as whole words (case-insensitive).
 * - Multi-word keywords (e.g. "work out", "lab report") match as a substring
 *   of the normalized text, so phrases aren't missed by word-splitting.
 * Returns { type, guessed } — guessed is true when NOTHING matched and we fell
 * back to the neutral default, so the UI can visibly flag it for the user.
 */
function tagTaskType(text) {
  if (!text) return { type: DEFAULT_TYPE, guessed: true };
  const lower = String(text).toLowerCase();
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  const wordSet = new Set(words);
  // Normalized text with single spaces, for phrase (multi-word) matching.
  const phrase = " " + words.join(" ") + " ";

  for (const type of TYPE_PRIORITY) {
    const kws = KEYWORDS[type];
    for (const kw of kws) {
      if (kw.indexOf(" ") === -1) {
        if (wordSet.has(kw)) return { type, guessed: false };
      } else {
        // phrase keyword: match on the normalized text
        if (phrase.indexOf(" " + kw + " ") !== -1) return { type, guessed: false };
      }
    }
  }
  return { type: DEFAULT_TYPE, guessed: true };
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

  return lines.map((text, i) => {
    const guess = tagTaskType(text);
    return {
      id: i + 1,
      text,
      type: guess.type,
      guessed: guess.guessed, // true when no keyword matched; UI flags it
      effort: effortForType(guess.type), // guessed from type, user-editable
      due: "later", // today | tomorrow | later; user-editable
    };
  });
}

// Expose for the browser and for Node/JSC tests.
if (typeof window !== "undefined") {
  window.HuifanTag = {
    TASK_TYPES,
    DEFAULT_TYPE,
    tagTaskType,
    effortForType,
    parseTasks,
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TASK_TYPES,
    DEFAULT_TYPE,
    tagTaskType,
    effortForType,
    parseTasks,
  };
}
