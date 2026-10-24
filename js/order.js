// order.js — morning task reorder (one pure function, no DOM).
//
// Implements the user's evidence-based default rules. The ranking is a stable
// sort on a small set of keys, so ties always keep the user's original order.
//
// Rules, in precedence order:
//   1. Tasks due today or tomorrow go first (today before tomorrow),
//      regardless of recovery score.
//   2. If last night's sleep < SLEEP_LOW_H: surface one quick (effort 1) task
//      first, and mark the most demanding (highest effort) task to be done in
//      20-25 minute chunks. We do NOT remove/merge tasks — the chunking is an
//      annotation on the task, so the list stays faithful (never add/rename).
//   3. We deliberately do NOT move cognitively demanding tasks later just
//      because HRV is low. The HRV-cognition link is between-person, not
//      within-person day to day, so there is no such rule here on purpose.
//   4. Learned adjustment: only move a task type later on low-recovery days
//      once the patterns page proves that type's completion drops on low days
//      (credible interval excludes no effect). Off until then; see the
//      `learnedDemotions` hook below.

const SLEEP_LOW_H = 6; // below this, apply the short-sleep rule
const CHUNK_LABEL = "do in 20–25 min chunks";

// Due buckets, lower sorts earlier.
const DUE_RANK = { today: 0, tomorrow: 1, later: 2 };

/**
 * Reorder tasks for the morning. Pure: returns a NEW array of the SAME task
 * objects (same identities, same count) in a new order, each annotated with
 * `movedBy` (the rule that placed it) and optionally `chunk` (the split hint).
 *
 * @param {Array} tasks  [{ id, text, type, effort, due }]
 *                        due ∈ {today, tomorrow, later}; defaults to later.
 * @param {Object} ctx    { sleepHours, band, learnedDemotions }
 *        sleepHours: number|null — last night's hours asleep
 *        band: "green"|"yellow"|"red"|null — today's recovery band
 *        learnedDemotions: string[] — task types the patterns page has proven
 *                          should go later on low days (empty until proven)
 * @returns {Object} { ordered: Task[], notes: string }
 */
function reorderTasks(tasks, ctx) {
  ctx = ctx || {};
  const sleepHours = ctx.sleepHours;
  const band = ctx.band || null;
  const learnedDemotions = ctx.learnedDemotions || [];

  // Work on shallow copies so we can annotate without mutating caller state,
  // but keep the SAME underlying task identity via `id`.
  const items = tasks.map(function (t, i) {
    return {
      ref: t,
      id: t.id,
      type: t.type,
      effort: typeof t.effort === "number" ? t.effort : 2,
      due: t.due || "later",
      origIndex: i,
      movedBy: null, // rule name, if this task was moved by a rule
      chunk: null, // CHUNK_LABEL if this is the demanding task to split
    };
  });

  const shortSleep =
    typeof sleepHours === "number" && sleepHours < SLEEP_LOW_H;
  const lowDay = band === "red";

  // --- Rule 2 prep: identify the quick task and the demanding task. --------
  let quickId = null;
  let demandingId = null;
  if (shortSleep) {
    // One quick task to lead with: the first effort-1 task in original order.
    const quick = items.find(function (it) {
      return it.effort === 1;
    });
    if (quick) quickId = quick.id;

    // The most demanding task: highest effort, earliest original index on tie.
    let maxEffort = -Infinity;
    items.forEach(function (it) {
      if (it.effort > maxEffort) {
        maxEffort = it.effort;
        demandingId = it.id;
      }
    });
    // Only treat it as "demanding to split" if it is genuinely high effort.
    if (maxEffort < 3) demandingId = null;
    if (demandingId !== null) {
      const d = items.find(function (it) {
        return it.id === demandingId;
      });
      if (d) d.chunk = CHUNK_LABEL;
    }
  }

  // --- Compute a sort key per item. Lower sorts earlier. -------------------
  // Groups (most significant first):
  //   0: due today
  //   1: due tomorrow
  //   2: short-sleep quick task (surface one easy win first)
  //   5: normal
  //   8: learned demotion on a low day (pushed later)
  // Within a group, original order is preserved via origIndex (stable).
  items.forEach(function (it) {
    // Default group.
    let group = 5;
    let reason = null;

    // Rule 4 (learned): only on a low (red) day, for proven task types.
    if (lowDay && learnedDemotions.indexOf(it.type) !== -1) {
      group = 8;
      reason =
        "moved later: your " +
        it.type +
        " completion drops on low-recovery days";
    }

    // Rule 2: the one quick task leads (unless it is already due-driven).
    if (shortSleep && it.id === quickId) {
      group = 2;
      reason = "quick task first after short sleep (" + fmtH(sleepHours) + ")";
    }

    // Rule 1 wins over everything: due today/tomorrow first.
    if (it.due === "today" || it.due === "tomorrow") {
      group = DUE_RANK[it.due]; // 0 or 1
      reason = "due " + it.due;
    }

    it.group = group;
    if (reason) it.movedBy = reason;

    // Annotate the demanding split task's reason if not otherwise moved.
    if (it.chunk && !it.movedBy) {
      it.movedBy =
        "most demanding task — " + CHUNK_LABEL + " after short sleep";
    }
  });

  // Stable sort: by group, then original index.
  items.sort(function (a, b) {
    if (a.group !== b.group) return a.group - b.group;
    return a.origIndex - b.origIndex;
  });

  // Build the output, returning the SAME task objects with annotations.
  const ordered = items.map(function (it) {
    // Attach annotations onto a shallow copy of the original task so the
    // caller can render movedBy/chunk without us mutating their array.
    return Object.assign({}, it.ref, {
      movedBy: it.movedBy,
      chunk: it.chunk,
    });
  });

  return { ordered: ordered, notes: buildNotes(ctx, shortSleep, lowDay) };
}

function fmtH(h) {
  return (Math.round(h * 10) / 10) + " h";
}

/** One short line describing the overall ordering strategy applied. */
function buildNotes(ctx, shortSleep, lowDay) {
  const parts = [];
  if (shortSleep) {
    parts.push(
      "Short sleep: easing in with a quick task; demanding work in chunks."
    );
  }
  if (lowDay && (ctx.learnedDemotions || []).length > 0) {
    parts.push("Low day: task types you tend to drop are moved later.");
  }
  if (parts.length === 0) {
    parts.push("Due-first ordering; your original order otherwise kept.");
  }
  return parts.join(" ");
}

// Expose for the browser and for Node/JSC tests.
if (typeof window !== "undefined") {
  window.HuifanOrder = { reorderTasks, SLEEP_LOW_H, CHUNK_LABEL };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { reorderTasks, SLEEP_LOW_H, CHUNK_LABEL };
}
