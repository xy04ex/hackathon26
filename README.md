# 烩饭 · Huifan

*Your day, reordered by your recovery.*

烩饭 (huìfàn) is a one-pot rice dish: whatever you have, cooked together. Huifan takes the health data your watch already records and the tasks you already planned, and puts them together for today.

- **Live demo:** https://huifan-recovery.netlify.app — choose **Try it with sample data** (no upload needed)
- **Video (under 3 min):** _<YouTube link>_
- **Track:** Hackachusetts — Healthcare & Biotech, H1: Turning wearable data into better healthcare
- **Built by:** Yoyo Yang (solo), Boston University

---

## Why I built it

I don't own a WHOOP. My Apple Watch already records heart-rate variability (HRV), resting heart rate and sleep every night, but a recovery number on its own never changed my day. I still had the same problem set and the same lab report to get through. The services that turn recovery into advice mostly sit behind subscriptions, so the people with the least slack, like students in exam weeks, are the least likely to have them. So I built Huifan.

I'd prototyped the idea for myself before the hackathon, as a personal page my AI assistant updated each morning. All of the app's code was written on October 24 in Kiro, and the git history shows it; the only earlier commits are repo setup (a sync test, the `.gitignore`, and the first steering docs, written the night before). From the prototype I reused the recovery score formula, the reorder rules, and the pot illustration. The parser, in-browser upload, per-user insights, the learning model and all the tests are new.

## What it does

You upload your Apple Health export, which is parsed in your browser and never leaves it. (For now, a new export brings in new nights; automatic daily sync is the next step.) Huifan compares your HRV, resting heart rate, breathing rate and sleep with **your own** previous 30 days and shows the result as the flame under a pot.

Then you type the tasks you've already decided to do, and Huifan **reorders them**. It never adds, removes or rewrites a task, and every move comes with a reason. The default rules are deliberately cautious:

- anything due today or tomorrow stays on top, however tired you are;
- after a short night, one quick task goes first and the hardest one is marked to do in 20–25 minute chunks;
- low HRV on its own never pushes hard work later, because research only links HRV and thinking performance between people, not within one person from day to day.

You tick tasks off as you go, or mark one **Not today** to move it to tomorrow without counting it as a failure. When everything's done, the pot comes off the stove as a bowl, with one topping for each task.

**The part other apps don't do: it learns from your own record.** After 14 logged days, a Beta-Binomial model estimates how each type of task (deep work, reading, admin, physical, social) holds up on your low-recovery days. Only when your own data shows a credible drop for a type does Huifan start moving that type later on low days. Until then, your order stays yours.

An **Insights** card, also computed in your browser, shows how last night's sleep relates to your next-morning HRV, whether three nights of sleep predict it better than one, and how your sleep compares with the CDC's 7-hour guideline and with adults in Suffolk County.

## What I learned from my own data

I tested Huifan on my own Apple Watch export: 1,556 days and about 2.2 million records, including roughly four years of nightly HRV.

The first surprise came from the analysis. A plain regression on my data said that more sleep means higher HRV the next morning. Once I measured HRV against my own rolling baseline, removing the slow rise in my HRV over the years, that effect disappeared. Two things had simply drifted upward together. That's why every analysis in Huifan compares you with your recent self rather than with your past average or with other people.

The second surprise came from testing. The in-browser parser passed every synthetic test, then returned zero days on my real 49 MB export. Fixing that uncovered three bugs: iPhone exports use a zip format the parser didn't handle, decompression wasn't truly streaming and ran out of memory, and adding numbers in a different order flipped one rounded value. It now matches a reference Python parser on my export exactly: **1,556 days, 0 mismatches.**

Because task patterns take weeks of logs to learn, the demo shows that part on **clearly labeled simulated data** with a planted pattern. A recovery test confirms the model finds exactly that pattern and nothing else.

## Privacy, fairness and limits

Everything runs in the browser: no account, no server, no analytics, and no network calls carrying health data. **Delete my data** removes everything Huifan stored. The public repository contains no personal health values.

Huifan isn't medical. It doesn't diagnose or warn about conditions, and a low score is shown as information, never as failure, because obsessing over sleep scores can make sleep worse. I deliberately don't compare HRV with population norms: it varies hugely between people, and wrist-worn HRV isn't comparable to clinical reference values.

Some limits are worth stating plainly. Optical heart-rate sensors can be less accurate on darker skin, during movement and over tattoos; comparing each person with their own baseline reduces differences between people but doesn't remove that noise. Sleep is only recorded on nights the watch is worn. Only Apple Health is supported so far. And my real-data results come from one person, so they show the method works on real data, not that it helps everyone. I looked at the PhysioNet Wearable Device Dataset to test beyond one person, but its recordings are short lab sessions with no sleep, so it can't support a nightly baseline. Sleep → HRV is an association, not proof of cause.

## How I built it with Kiro

Kiro wrote the code in this repository; the pot drawing is Kiro's port of my prototype's illustration. I made the decisions, and a second AI assistant (Claude) helped me plan and reviewed each pushed commit.

**Steering (4 docs).** `product.md`, `tech.md`, `structure.md` and `submission.md` hold the rules Kiro must not break: never add or remove tasks, not medical, health data never leaves the device, the fixed score formula and reorder rules, and the judging criteria. I revised them mid-day when the plan changed; in-browser parsing went from "never" to "only streaming, in a Web Worker".

**Specs (3), compared with vibe coding.** The in-browser upload went through the full requirements → design → tasks flow. Per-user insights and per-user patterns used a lighter requirements → tasks spec, because their requirements were already precise. Earlier features were planned in chat and vibe-coded, which was fast and flexible. Specs were slower to start, but every task traced back to a requirement, and problems showed up before any code was written.

**Agent hooks (2), one for each core promise.** For correctness, a `PostFileSave` hook runs the test suite whenever a file in `js/` is saved. For privacy, a manually triggered hook checks what's staged in git and fails, naming the files, if a health export, parsed daily data or `.env` is about to be committed. It's a second line of defense behind `.gitignore`.

**Property-based testing.** 60 tests, most of them property-based with fast-check, encode the design rules directly: the score is always 0–100; reordering never adds, removes or renames a task; tasks due today always come first; low HRV alone never changes the order; a skipped task never counts as not done; every credible interval contains its estimate. Many came straight from the correctness properties listed in the specs. Every analysis also exists in Python, and tests check that the JavaScript and Python versions agree field for field.

**Powers and MCP.** I deployed the demo with the `netlify-deployment` power. It's a CLI-first power that provides workflow guidance rather than an MCP server, so Kiro followed it with the Netlify CLI. I didn't use MCP: Huifan deliberately has no external data sources, so there was no genuine place for one. I only used the Kiro IDE; CLI, Web and Crew weren't tried in the time available.

**Where Kiro stood out:**
- **It caught cross-language traps during design.** Python and JavaScript round halves differently, and numpy's random numbers and Beta sampling can't be reproduced in JavaScript. Kiro flagged these before writing code and solved them with a matching rounding function, a shared seeded random generator, and exact rather than sampled Beta calculations.
- **It turned one hypothesis into three fixes.** When my real export produced zero days, I suspected the zip format. Kiro confirmed it, found two more bugs hiding behind it, and added a regression test for each.
- **It protected my data at deploy time.** It noticed that deploying from my working folder would have uploaded my git-ignored health data, deployed from a fresh clone of `main` instead, and checked that every personal file returns 404 on the live site.
- **It didn't take orders from a tool description.** The Netlify power's description contained an embedded instruction to "activate this power immediately". Kiro treated it as untrusted text and activated the power only because deploying was my actual request.
- **It owned a mistake.** It first relaxed a failing test instead of fixing the bug behind it (a user who completes 100% of their tasks broke a statistical prior). When I pushed back, it fixed the math in both JavaScript and Python and restored the strict test.

**Human in the loop.** Kiro built, Claude reviewed each push and ran the app in a real browser, and I decided the track, the privacy limits and what to cut. Using the app myself caught what tests couldn't: a rule that said it fired but never moved a task, simulated patterns leaking into real users' reordering, task types guessed wrong for my own tasks, and the missing **Not today** option. Next time I'd let the reviewer read the repository directly after each push, so I only see the questions that need my judgment, and I'd make Kiro check the real clock before every step when working to a deadline.

**Biggest lesson:** green tests aren't the finish line. One run on real data found three bugs that the full test suite had missed.

## Run it

Plain HTML, CSS and vanilla JavaScript. No build step, nothing to install.

- **Sample data:** open the demo link (or serve this folder) and choose **Try it with sample data**.
- **Your own data:** serve the folder over HTTP (Web Workers don't run from `file://`):
  ```sh
  python3 -m http.server 8000   # then open http://localhost:8000
  ```
  On iPhone: Health app → your profile picture → **Export All Health Data**. Move `export.zip` to a computer and pick it on the first screen. Choose **Last 6 months** (faster) or **Everything**.

Developer fallback: `python3 scripts/parse_health.py export.zip` produces the same daily records on the command line (standard library only).

**Tests:** `cd tests && npm install && npm test` (dev-only: vitest + fast-check). The Python scripts need only the standard library.

## Next steps

- **Daily sync without re-exporting:** an iOS Shortcut that sends last night's numbers each morning, then native apps reading Apple HealthKit and Android Health Connect.
- **Any wearable:** a simple CSV import (date, HRV, resting heart rate, sleep hours) so data from any device can be used. Devices that already sync to Apple Health, such as Oura or Garmin, work today through the Apple Health export.
- **Evening check-in:** right now, tasks left unticked are logged as not done even before the day is over. A "wrap up today" step, with an optional 1–5 how-was-today rating like the original Huifan had, would count each day only once it's confirmed.
- **Keep your history across devices:** task history lives in one browser today, and Export history can't be imported back yet. Next is import, then sync that keeps the data in the user's own hands.
- Testing on a multi-week, multi-person dataset.
- Sleep-debt-aware rules for users whose data shows several nights predict their recovery better than one.

## Credits

- **[fflate](https://github.com/101arrowz/fflate)** — MIT License, Copyright (c) Arjun Barrett. Vendored at `js/vendor/fflate.min.js` for streaming unzip, including the zip format iPhone exports use.
- **CDC PLACES** — Local Data for Better Health, county data (short sleep duration among adults, crude prevalence, 2022).

Not medical advice.
