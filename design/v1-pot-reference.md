# 烩饭 v1 visual reference (pot + palette)

Extracted from the original 烩饭 1.0 page so the new app can reuse its look. Reference only: port what is useful into style.css / js, then this folder can be deleted. No personal data here.

## Fonts (Google Fonts)

Display: ZCOOL QingKe HuangYou (title, big numbers). Body: Red Hat Text. Numbers/labels: Red Hat Mono.
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=ZCOOL+QingKe+HuangYou&family=Red+Hat+Mono:wght@400;500&family=Red+Hat+Text:wght@400;500;600&display=swap">
```

## Palette tokens (light, dark) and pot/flame styles
```css
  :root {
    --bg: #FAF3E3;
    --surface: #FFFDF7;
    --sunk: #F0E6D0;
    --paper: #FFFEFA;
    --ink: #2A1F1A;
    --ink2: #6B5B50;
    --ink3: #9A8A7C;
    --line: #E3D6BD;
    --accent: #1D4AA0;
    --accent-soft: #DFE7F6;
    --sign: #C8321E;
    --sign-ink: #FFE9A8;
    --mustard: #E9A820;
    --good: #23875A;
    --good-soft: #DCEFE4;
    --mid: #9A6A08;
    --mid-soft: #F5EBD0;
    --bad: #BA3E32;
    --bad-soft: #F6E0DC;
    --pot: #1D4AA0;
    --pot-dark: #153676;
    --pot-ink: #FFFFFF;
    --flame: #E2571C;
    --flame2: #F7B32B;
    --rice: #FFFDF5;
    --raw: #EFE7D3;
    --raw-line: #B4A78C;
    --f1: #3E9B4F; --f2: #E8892B; --f3: #F2C230; --f4: #8A5A3C; --f5: #E77B6E;
    --stove: #3A2E27;
    --tile: #EADFC6;
    --tile-bg: #FFFAEC;
    --on-c: #FFFFFF;
    --display: "ZCOOL QingKe HuangYou", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    --body: "Red Hat Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, sans-serif;
    --mono: "Red Hat Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #17120F; --surface: #211A16; --sunk: #120E0B; --paper: #261E19;
      --ink: #F1E8DC; --ink2: #B9AA9B; --ink3: #8A7B6D; --line: #3A2F27;
      --accent: #8FB0EE; --accent-soft: #1C2A45;
      --sign: #A82A19; --sign-ink: #FFE08A; --mustard: #E9B23A;
      --good: #5CCB93; --good-soft: #143024;
      --mid: #E2B550; --mid-soft: #33290F;
      --bad: #EE8377; --bad-soft: #3A1C18;
      --pot: #2C5BC0; --pot-dark: #1D418F; --pot-ink: #F4F7FF;
      --flame: #F2702F; --flame2: #FFC94A;
      --rice: #EDE8DA; --raw: #C9C5B6; --raw-line: #8F8B7C;
      --stove: #6A5A4E; --tile: #2E251F; --tile-bg: #1D1713;
      --on-c: #17120F;
      color-scheme: dark;
    }
  }
  .stove {
    flex: 0 0 auto;
    width: 232px;
    max-width: 100%;
    margin-inline: auto;
    border-radius: 10px;
    padding: 10px 8px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    background-color: var(--tile-bg);
    background-image: linear-gradient(var(--tile) 1px, transparent 1px), linear-gradient(90deg, var(--tile) 1px, transparent 1px);
    background-size: 29px 29px;
    background-position: -1px -1px;
  }
  .stove svg { width: 100%; height: auto; display: block; }
  .pot-body { fill: var(--pot); }
  .pot-rim { fill: var(--pot-dark); }
  .pot-spk { fill: var(--pot-ink); opacity: .32; }
  .pot-num { fill: var(--pot-ink); font-family: var(--display); font-size: 40px; font-variant-numeric: tabular-nums; }
  .pot-rice { fill: var(--rice); stroke: var(--raw-line); stroke-width: 1; }
  .top.raw { fill: var(--raw); stroke: var(--raw-line); stroke-width: 1.2; stroke-dasharray: 2.5 2; }
  .top.f1 { fill: var(--f1); } .top.f2 { fill: var(--f2); } .top.f3 { fill: var(--f3); } .top.f4 { fill: var(--f4); } .top.f5 { fill: var(--f5); }
  .stove-bar { fill: var(--stove); }
  .fl-o { fill: var(--flame); } .fl-i { fill: var(--flame2); }
  .fl { transform-box: fill-box; transform-origin: 50% 100%; }
  .st { fill: none; stroke: var(--ink3); stroke-width: 3; stroke-linecap: round; opacity: .55; }
  .heat { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px 8px; }
  .heat-chip { font-size: 12.5px; font-weight: 600; border-radius: 20px; padding: 2px 10px; background: var(--sunk); color: var(--ink2); white-space: nowrap; }
  .heat-chip.g { background: var(--good-soft); color: var(--good); }
  .heat-chip.m { background: var(--mid-soft); color: var(--mid); }
  .heat-chip.r { background: var(--bad-soft); color: var(--bad); }
  .heat-n { font-family: var(--mono); font-size: 11.5px; color: var(--ink2); font-variant-numeric: tabular-nums; }
  .rec-wait { margin: 0; font-size: 14.5px; color: var(--ink2); }
  @media (prefers-reduced-motion: no-preference) {
    .fl { animation: flick .8s ease-in-out infinite alternate; }
    .st { animation: steam 3s ease-in-out infinite; }
  }
  @keyframes flick { from { transform: scale(1.06, .8); } to { transform: scale(.94, 1.08); } }
  @keyframes steam { 0% { opacity: 0; transform: translateY(7px); } 35% { opacity: .7; } 100% { opacity: 0; transform: translateY(-9px); } }
```

## Pot drawing (SVG): flame height = recovery band, toppings = tasks (coloured once done), steam = share done, lid on until tasks are in
```js
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  var HEAT = { g: "大火", m: "中火", r: "小火" };
  var FLAMES = { g: [7, 24], m: [5, 16], r: [3, 9] };
  var SPOTS = [[118, 72], [84, 89], [153, 83], [100, 79], [136, 75], [167, 91], [110, 91], [143, 92]];
  /* Up to 8 toppings sit in the hand-placed spots. More than that and they
     shrink and line up in rows across the rice, so every task still shows. */
  var ROWS = [[90, 57], [80.5, 46], [71.5, 32]];   /* y, half-width of the rice at that height */
  function spotsFor(n) {
    if (n <= SPOTS.length) return { r: 7, pts: SPOTS.slice(0, n) };
    var sizes = [5.5, 4.5], r = 0, caps = [], total = 0;
    for (var s = 0; s < sizes.length; s++) {
      r = sizes[s];
      caps = ROWS.map(function (row) { return Math.floor(2 * (row[1] - r - 2) / (2 * r + 2)) + 1; });
      total = caps[0] + caps[1] + caps[2];
      if (total >= n) break;
    }
    var m = Math.min(n, total), cnt = [0, 0, 0];
    for (var k = 0; k < m; k++) {
      var best = -1, bestFill = 2;
      for (var i = 0; i < 3; i++) {
        var fill = (cnt[i] + 1) / caps[i];
        if (cnt[i] < caps[i] && fill < bestFill) { best = i; bestFill = fill; }
      }
      cnt[best]++;
    }
    var pts = [];
    ROWS.forEach(function (row, i) {
      for (var j = 0; j < cnt[i]; j++) pts.push([120 + (j - (cnt[i] - 1) / 2) * (2 * r + 2), row[0]]);
    });
    return { r: r, pts: pts };
  }

  function drawPot(box) {
    clear(box);
    var d = days[TODAY];
    var r = d && d.recovery;
    var scored = !!(r && typeof r.score === "number");
    var b = scored ? bandOf(r.score) : null;
    var tasks = split(d).on;
    var checks = checksOf(d), doneN = 0;
    var state = tasks.map(function (t) { var on = !!checks[t.id]; if (on) doneN++; return on; });
    var open = tasks.length > 0;
    var moves = d && d.move && Array.isArray(d.move.options) ? d.move.options : [], moveN = 0;
    moves.forEach(function (o, i) { if (checks[String(o.id || ("move-" + i))]) moveN++; });

    var label = (scored ? HEAT[b] + "，recovery " + Math.round(r.score) : open ? "还没点火" : "还没下锅") +
      (open ? "；锅里 " + tasks.length + " 样，熟了 " + doneN + " 样" : "") +
      (moveN ? "；动了 " + moveN + " 次" : "");
    var svg = sv("svg", { viewBox: "18 0 244 212", role: "img", "aria-label": label });

    /* steam */
    var wisps = open && doneN ? Math.max(1, Math.round(doneN / tasks.length * 3)) : 0;
    [100, 122, 144].slice(0, wisps).forEach(function (x, i) {
      var p = sv("path", { "class": "st", d: "M" + x + " 50 q-7 -8 0 -16 q7 -8 0 -16" }, svg);
      p.style.animationDelay = (i * 0.9) + "s";
    });

    /* rice and toppings, visible once the lid is off */
    if (open) {
      sv("path", { "class": "pot-rice", d: "M56 97 Q120 30 184 97 Z" }, svg);
      var lay = spotsFor(state.length), tr = lay.r, tw = tr * 15 / 7, th = tr * 11 / 7;
      state.slice(0, lay.pts.length).forEach(function (on, i) {
        var p = lay.pts[i], cls = "top " + (on ? "f" + (i % 5 + 1) : "raw");
        if (i % 2) sv("rect", { "class": cls, x: p[0] - tw / 2, y: p[1] - th / 2, width: tw, height: th, rx: tr / 2, transform: "rotate(" + (i * 23 - 30) + " " + p[0] + " " + p[1] + ")" }, svg);
        else sv("circle", { "class": cls, cx: p[0], cy: p[1], r: tr }, svg);
      });
    }

    /* pot */
    sv("rect", { "class": "pot-rim", x: 26, y: 112, width: 30, height: 13, rx: 6.5 }, svg);
    sv("rect", { "class": "pot-rim", x: 184, y: 112, width: 30, height: 13, rx: 6.5 }, svg);
    sv("path", { "class": "pot-body", d: "M52 104 L188 104 Q189 160 162 169 L78 169 Q51 160 52 104 Z" }, svg);
    sv("rect", { "class": "pot-rim", x: 44, y: 94, width: 152, height: 13, rx: 6.5 }, svg);
    [[66, 122], [74, 148], [92, 160], [168, 118], [174, 142], [154, 158], [84, 116], [160, 128], [108, 162], [140, 114]].forEach(function (p, i) {
      sv("circle", { "class": "pot-spk", cx: p[0], cy: p[1], r: i % 3 ? 1.3 : 2 }, svg);
    });
    if (scored) {
      var num = sv("text", { "class": "pot-num", x: 120, y: 151, "text-anchor": "middle" }, svg);
      num.textContent = String(Math.round(r.score));
    }

    /* lid: on the pot until the list is in, then leaning against it */
    var lid = sv("g", { transform: open ? "translate(236 140) rotate(76) scale(.9)" : "translate(120 82)" }, svg);
    sv("path", { "class": "pot-rim", d: "M-68 13 Q-64 -12 0 -14 Q64 -12 68 13 Z" }, lid);
    sv("rect", { "class": "pot-body", x: -11, y: -25, width: 22, height: 12, rx: 6 }, lid);

    /* stove and flame */
    sv("rect", { "class": "stove-bar", x: 66, y: 169, width: 6, height: 29 }, svg);
    sv("rect", { "class": "stove-bar", x: 168, y: 169, width: 6, height: 29 }, svg);
    sv("rect", { "class": "stove-bar", x: 40, y: 197, width: 216, height: 8, rx: 4 }, svg);
    if (scored) {
      var n = FLAMES[b][0], h = FLAMES[b][1];
      for (var i = 0; i < n; i++) {
        var x = 120 + (i - (n - 1) / 2) * 13;
        var hh = h * (i % 2 ? 0.8 : 1);
        var g = sv("g", { "class": "fl" }, svg);
        g.style.animationDelay = (-i * 0.23) + "s";
        sv("path", { "class": "fl-o", d: "M" + (x - 5.5) + " 197 Q" + (x - 7) + " " + (197 - hh * 0.5) + " " + x + " " + (197 - hh) + " Q" + (x + 7) + " " + (197 - hh * 0.5) + " " + (x + 5.5) + " 197 Z" }, g);
        sv("path", { "class": "fl-i", d: "M" + (x - 2.5) + " 197 Q" + (x - 3.5) + " " + (197 - hh * 0.3) + " " + x + " " + (197 - hh * 0.55) + " Q" + (x + 3.5) + " " + (197 - hh * 0.3) + " " + (x + 2.5) + " 197 Z" }, g);
      }
    }
    box.appendChild(svg);

    var cap = el("div", "heat");
    cap.appendChild(el("span", "heat-chip" + (b ? " " + b : ""), scored ? HEAT[b] + " · " + BAND[b] : open ? "还没点火" : "还没下锅"));
    if (open) cap.appendChild(el("span", "heat-n", (doneN === tasks.length ? "全熟了，出锅" : "锅里 " + tasks.length + " 样 · 熟了 " + doneN + " 样") + (moveN ? " · 动了 " + moveN + " 次" : "")));
    box.appendChild(cap);
  }
  function updatePot() { var box = $("pot-box"); if (box) drawPot(box); }
```
