---
inclusion: always
---

# 烩饭 (Huifan) — product

## What it is
烩饭 turns health data that a normal phone or watch already records (HRV, resting heart rate, sleep) into a daily **recovery score** measured against the user's **own** baseline, then **reorders the tasks the user has already decided to do today** so the order fits how recovered they are.

It is a free, on-device, WHOOP-like experience for people who don't own a WHOOP. The builder (Yoyo, a BU biology student) made it because she doesn't own one and uses 烩饭 herself. She is the first and current user.

## What it is NOT — do not drift into these
- **Not a task recommender.** It never adds, invents, suggests, or deletes tasks. Input list in → same list, new order, out.
- **Not a fitness or athletic-recovery app.** No workout plans, training load, strain, or exercise advice.
- **Not medical.** No diagnosis, no warnings about conditions, no clinical language. It's a wellness and planning aid.
- **Not a chatbot.** The score comes from a fixed, deterministic formula so today and tomorrow are directly comparable. Same input → same output.

## Core flow (the demo)
1. User exports Apple Health data (export.zip) on their iPhone and **uploads it in the browser**. "Upload" means into the user's own browser only — the file is parsed locally and never sent anywhere.
2. The browser parses export.zip locally (streaming unzip + XML in a Web Worker) into a small daily JSON (HRV, resting HR, respiratory rate, sleep hours). A local Python parser stays as a fallback for developers.
3. The web page loads that JSON, computes a personal baseline from recent days, and shows today's recovery score with a plain-language reason ("HRV 12% below your usual, slept 6.1 h").
4. User types or pastes today's tasks and marks each one's effort.
5. 烩饭 shows the reordered list and one short line on why.
6. Each day's score, order, and what actually got done are kept, so the user can later check whether reordering helped.

## Why not just ask a chatbot (keep these true in the build)
- **Stable personal baseline** — "HRV 45" means nothing alone; it matters relative to the user's own recent average.
- **Zero effort each morning** — open it and it's already sorted; no prompting on a low-energy day.
- **History** — a record of score → order → outcome over weeks.

## Context data
CDC PLACES "short sleep duration among adults" for Massachusetts counties (2022) — the share of adults sleeping < 7 h. Used only as one line of context, e.g. "You slept 6.2 h. About X% of Suffolk County adults regularly sleep under 7 h." Never as a judgement of the user.

## Audience & framing
- Hackathon tracks: Hackachusetts "Healthcare & Biotech — H1: Turning wearable data into better healthcare"; DS+X: CollegeHack (possibly entered as an individual).
- Users: students first (exam weeks, irregular sleep, can't afford subscriptions). Wider use (shift workers, people with variable energy) is a belief to test, not a claim.
- Pitch honestly: n=1 real use shows it works for one person; it does not prove broad impact. Copy in the UI and README must not overstate.

## Privacy
Data stays on the user's device. No accounts, no login, no backend server, no analytics. When the user "uploads" export.zip, it goes into their own browser only — it is parsed locally and no network call ever carries health data anywhere. This is a core feature, not an afterthought.

## Tone of the UI
Calm, short, friendly, non-judgemental. A low score is information, not failure — never shame the user for sleeping badly.
