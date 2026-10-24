---
inclusion: always
---

# 烩饭 — submission checklist & judging

Keep the build aligned with how it will be judged and what the submission
requires. The deadline is Saturday Oct 24, 8 PM Eastern (SundAI).

## Hackachusetts judging criteria
- **Potential Value** — solves a real problem; scalability; usefulness;
  accessibility; equity; likelihood of adoption. Frame honestly: n=1 real use
  shows it works for one person, not broad impact.
- **Implementation** — depth and range of Kiro use. Show specs (`.kiro/specs/`),
  agent hooks (`.kiro/hooks/`), steering (`.kiro/steering/`), and property-based
  testing (fast-check under `tests/`).
- **Quality & Design** — creativity, polish, an intuitive UI. Mobile-friendly,
  light/dark, calm non-judgemental tone.

## Required deliverables
- Demo video **under 3 minutes**.
- **Public GitHub repo** with clear run instructions in the README.
- `.kiro/` at the **repo root** and **NOT gitignored** (steering, specs, hooks
  must be visible to judges).
- English text description of the project.
- A short **Kiro usage write-up** (how specs, hooks, steering, and tests were
  used to build it).
- A working **demo link**.

## Hard rules
- **All user-facing text and docs are in English.**
- The repo holds **only aggregate results, never raw personal health values**.
  Real `export.zip`, `export.xml`, `data/daily.json`, and `data/daily.js` stay
  git-ignored. Committed JSON (`insights.json`, `patterns.json`, sample data)
  contains summaries only.
- Prefer a working, simple demo over extra features.
