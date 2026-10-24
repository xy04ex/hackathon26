---
inclusion: always
---

# 烩饭 — project structure

```
hackathon26/
├── index.html            # the app (single page)
├── style.css             # light + dark via CSS variables
├── js/
│   ├── score.js          # baseline + recovery score (pure functions)
│   ├── order.js          # task reordering (pure function)
│   ├── tag.js            # keyword task-type tagger (pure, fallback)
│   ├── patterns.js       # render Beta-Binomial results (no math in browser)
│   ├── insights.js       # render sleep→HRV + CDC context (no math in browser)
│   └── app.js            # UI wiring, localStorage history
├── scripts/
│   ├── parse_health.py       # export.zip/xml → data/daily.json (stdlib only)
│   ├── tag_tasks_llm.py      # optional LLM tagging, reads .env (keyword is default)
│   ├── fetch_cdc.py          # CDC PLACES MA → data/cdc-short-sleep-ma.json
│   ├── make_sim_data.py      # labeled SIMULATED logs w/ planted pattern
│   ├── patterns.py           # Beta-Binomial by type×tier → data/patterns.json
│   ├── insights.py           # lagged sleep→HRV correlation → data/insights.json
│   └── logistic_regression.py # stretch: completed ~ recovery_z * task_type
├── data/
│   ├── sample-daily.json        # synthetic demo data (committed)
│   ├── cdc-short-sleep-ma.json  # CDC PLACES, MA counties (committed)
│   ├── simulated-logs.json      # labeled SIMULATED task logs (committed)
│   ├── patterns.json            # Beta-Binomial output (committed)
│   └── insights.json            # correlation + CDC summary (committed)
├── requirements.txt      # numpy, scipy, scikit-learn (analysis scripts only)
├── .env.example          # shows LLM_API_KEY= (no real key)
├── .kiro/steering/       # these files
└── README.md
```

Note: the health parser (`parse_health.py`) uses the Python standard library only.
Only the data-science scripts (`patterns.py`, `insights.py`, `logistic_regression.py`)
need `requirements.txt`. The web app needs no install.

## Rules
- Keep this layout unless there's a clear reason to change it; if you add a file, say where and why.
- `data/daily.json`, `export.zip`, `export.xml`, `apple_health_export/`, and `.env` are git-ignored (real personal data / secrets).
- The project is worked on by two agents taking turns (Kiro and Claude) through GitHub. Make small, self-contained changes so each commit can be rolled back on its own.
- The submission deadline is Saturday Oct 24, 8 PM Eastern (submitted on SundAI). Prefer a working, simple demo over extra features. If a feature is not in product.md's core flow, ask before building it.
