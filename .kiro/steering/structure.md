---
inclusion: always
---

# 烩饭 — project structure

```
hackathon26/
├── index.html            # the app (single page)
├── style.css
├── js/
│   ├── score.js          # baseline + recovery score (pure functions)
│   ├── order.js          # task reordering (pure function)
│   └── app.js            # UI wiring, localStorage history
├── scripts/
│   └── parse_health.py   # export.zip / export.xml → data/daily.json
├── data/
│   ├── sample-daily.json # synthetic demo data (committed)
│   └── cdc-short-sleep-ma.json  # CDC PLACES, MA counties (committed)
├── .kiro/steering/       # these files
└── README.md
```

## Rules
- Keep this layout unless there's a clear reason to change it; if you add a file, say where and why.
- `data/daily.json`, `export.zip`, `export.xml`, `apple_health_export/` are git-ignored (real personal data).
- The project is worked on by two agents taking turns (Kiro and Claude) through GitHub. Make small, self-contained changes so each commit can be rolled back on its own.
- The submission deadline is Saturday Oct 24, 8 PM Eastern (submitted on SundAI). Prefer a working, simple demo over extra features. If a feature is not in product.md's core flow, ask before building it.
