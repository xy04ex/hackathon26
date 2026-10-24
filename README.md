# 烩饭 · Huifan

Turn the health data your phone or watch already records (HRV, resting heart
rate, respiratory rate, sleep) into a daily **recovery score** measured against
**your own** baseline — then reorder the tasks you already planned for today to
fit how recovered you are. Free, on-device, no account, no server.

Your health data stays on your device. When you "upload" your Apple Health
export, it is parsed **in your browser** and never sent anywhere.

## Run it

The app is plain HTML + CSS + vanilla JavaScript — no build step.

- **Quick look (sample data):** open `index.html` in a browser, or serve the
  folder, and choose **Try with sample data** on the first screen. This uses a
  small synthetic dataset so you can see how everything works without uploading
  anything.
- **Your own data:** the in-browser onboarding (uploading your Apple Health
  `export.zip`) uses a Web Worker, which browsers only allow over `http(s)`, not
  from a `file://` page. So serve the folder first:

  ```sh
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```

  On the first screen, follow the three export steps, pick your `export.zip`,
  and the app parses it locally into your daily dataset. Use **Delete my data**
  any time to remove it from your browser.

Tip: uploading the export is easier from a computer than a phone.

### Developer fallback parser

`scripts/parse_health.py` does the same parse on the command line (Python
standard library only) and is handy for verifying parity:

```sh
python3 scripts/parse_health.py export.zip   # writes data/daily.json (git-ignored)
```

## Tests

Property-based tests (fast-check + vitest) live under `tests/` and are dev-only
— they are not needed to run the app.

```sh
cd tests && npm install && npm test
```

## Privacy

No accounts, no login, no backend, no analytics. Real exports
(`export.zip`, `export.xml`, `data/daily.json`, `data/daily.js`) are
git-ignored and must never be committed. Only aggregate/synthetic data is in the
repo.

## Credits

- **[fflate](https://github.com/101arrowz/fflate)** — MIT License, Copyright (c)
  Arjun Barrett. A pure-JavaScript, dependency-free compression library.
  Vendored as a static file at `js/vendor/fflate.min.js` and used in the parse
  Web Worker as a streaming-unzip fallback when the browser lacks native
  `DecompressionStream`. It is not an npm runtime dependency.
