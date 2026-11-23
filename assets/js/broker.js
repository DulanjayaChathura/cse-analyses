/* Broker updates page: one day's summary of the broker's messages.
   Data: data/broker/index.json (list of days) and data/broker/<date>.json.
   Companies on the site (data/index.json) are matched by share code so the
   broker's call can be shown next to my own fair value. */
"use strict";

(async function () {
  App.init();
  const content = document.getElementById("content");
  const sub = document.getElementById("sub");
  const sel = document.getElementById("day");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");

  let list, index;
  try {
    [list, index] = await Promise.all([App.load("data/broker/index.json"), App.loadOptional("data/index.json", { companies: [] })]);
  } catch (e) {
    content.innerHTML = `<div class="empty">The broker updates couldn't be loaded. Reload the page.</div>`;
    sub.textContent = "";
    return;
  }
  const days = list.days || [];
  if (!days.length) {
    content.innerHTML = `<div class="empty">No broker updates yet. Forward the broker's messages to the Telegram channel and post /summary in the channel to get them summarised here.</div>`;
    sub.textContent = "";
    return;
  }

  /* Map every share code on the site (voting and non-voting) to its company. */
  const mine = {};
  for (const c of index.companies || []) {
    for (const sc of c.shareClasses || [{ symbol: c.ticker }]) mine[sc.symbol] = c;
  }

  sel.innerHTML = days.map((d) => `<option value="${App.esc(d.date)}">${App.date(d.date)}</option>`).join("");
  const wanted = new URLSearchParams(location.search).get("d");
  let pos = Math.max(0, days.findIndex((d) => d.date === wanted));

  async function show(i) {
    pos = i;
    const d = days[i];
    sel.value = d.date;
    prevBtn.disabled = i >= days.length - 1;   // days are newest first
    nextBtn.disabled = i <= 0;
    history.replaceState(null, "", `?d=${d.date}`);
    try {
      render(await App.load(`data/broker/${d.file}`));
    } catch (e) {
      content.innerHTML = `<div class="empty">The update for ${App.date(d.date)} couldn't be loaded.</div>`;
    }
  }
  prevBtn.onclick = () => show(Math.min(days.length - 1, pos + 1));
  nextBtn.onclick = () => show(Math.max(0, pos - 1));
  sel.onchange = () => show(days.findIndex((d) => d.date === sel.value));

  /* ---------- small helpers ---------- */
  const upside = (c) => (App.isNum(c.target) && App.isNum(c.price) && c.price > 0 ? (c.target / c.price - 1) * 100 : null);
  const ratingCls = (r) => ({ "buy": "buy", "moderate buy": "mbuy", "hold": "hold", "sell": "sell" }[(r || "").toLowerCase()] || "hold");
  const chip = (r) => `<span class="rchip ${ratingCls(r)}">${App.esc(r || "–")}</span>`;
  const pct = (v, dec = 0) => (App.isNum(v) ? `${v > 0 ? "+" : ""}${v.toFixed(dec)}%` : "–");
  const tile = (label, value, foot, cls = "") =>
    `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value ${cls}">${value}</div><div class="tile-foot">${foot}</div></div>`;
  const newsCard = (n) => `<article class="bk-news-card"><h3>${App.esc(n.title)}</h3><p>${App.esc(n.text)}</p></article>`;

  /* Price, this site's value and the broker's target as dots on one line, labelled. */
  function dotLine(marks, small) {
    const m = marks.filter((x) => App.isNum(x[2]));
    const lo = Math.min(...m.map((x) => x[2])) * 0.9, hi = Math.max(...m.map((x) => x[2])) * 1.06;
    const x = (v) => ((v - lo) / (hi - lo) * 100).toFixed(1);
    // Labels close together (under about 22% of the width apart) alternate above and below the line.
    const order = m.map((k, i) => i).sort((a, b) => m[a][2] - m[b][2]), up = new Set();
    let lastDown = -1e9;
    order.forEach((i) => { const px = +x(m[i][2]); if (px - lastDown < 22) up.add(i); else lastDown = px; });
    return `<div class="dl${small ? " sm" : ""}${up.size && !small ? " two" : ""}" role="img" aria-label="${m.map((k) => `${k[1]} ${k[2]}`).join(", ")}"><div class="dl-trk"></div>
      ${m.map((k, i) => `<div class="dl-pt ${k[0]}${up.has(i) ? " up" : ""}" style="left:${x(k[2])}%"><i></i>${small ? "" : `<span>${k[1]}<b>${fmt(k[2])}</b></span>`}</div>`).join("")}</div>`;
  }

  /* A broker research report (earnings note, market update…): rating, target, key points,
     their forecasts, risks and catalysts, next to this site's own view when it covers the company. */
  function researchCard(r) {
    const co = r.code ? mine[r.code] : null;
    const fv = co && co.valuation ? co.valuation.fairValue : null, buy = co && co.valuation ? co.valuation.buyPrice : null;
    const up = App.isNum(r.target) && App.isNum(r.price) && r.price > 0 ? (r.target / r.price - 1) * 100 : null;
    const gap = App.isNum(fv) && App.isNum(r.target) ? (r.target / fv - 1) * 100 : null;
    const list = (title, items, cls) => (items || []).length
      ? `<div class="rs-part ${cls}">${title ? `<h4>${title}</h4>` : ""}<ul>${items.map((x) => `<li>${App.esc(typeof x === "string" ? x : `${x.label}: ${x.value}`)}</li>`).join("")}</ul></div>` : "";
    return `<article class="rs-card${(r.details || []).length ? " rs-wide" : ""}">
      <div class="rs-head">
        <div><h3>${co ? `<a href="company.html?t=${encodeURIComponent(co.ticker)}">★ ${App.esc(r.company)}</a>` : App.esc(r.company)}${r.code ? ` <span class="muted-s">${App.esc(r.code.split(".")[0])}</span>` : ""}</h3>
          <div class="muted-s">${App.esc(r.report || "")}${r.date ? ` · ${App.date(r.date)}` : ""}</div></div>
        ${r.rating ? `<div class="rs-rating">${chip(r.rating)}${r.prevRating ? `<div class="muted-s">was ${App.esc(r.prevRating)}</div>` : ""}</div>` : ""}
      </div>
      ${App.isNum(r.target) || App.isNum(r.price) ? `<div class="rs-nums">
        ${App.isNum(r.target) ? `<div><small>Their target</small><b>${App.rs(r.target)}</b></div>` : ""}
        ${App.isNum(r.price) ? `<div><small>Price${r.priceDate ? ` (${App.date(r.priceDate)})` : ""}</small><b>${App.price(r.price)}</b></div>` : ""}
        ${App.isNum(up) ? `<div><small>Upside</small><b class="${up >= 0 ? "up" : "down"}">${pct(up)}</b></div>` : ""}
        ${App.isNum(fv) ? `<div class="rs-mine"><small>This site</small><b>${App.rs(fv)}</b><em>buy below ${App.rs(buy)}</em></div>` : ""}
      </div>` : ""}
      ${App.isNum(r.price) && (App.isNum(fv) || App.isNum(r.target)) ? dotLine([["price", "Price", r.price], ["fv", "This site", fv], ["tg", "Their target", r.target]]) : ""}
      ${App.isNum(gap) && Math.abs(gap) >= 25 ? `<p class="rs-flag">Big gap: their target is ${pct(gap)} vs this site's fair value.</p>` : ""}
      ${(r.glance || []).length ? `<ul class="rs-glance">${r.glance.map((x) => `<li>${App.esc(x)}</li>`).join("")}</ul>` : list("Key points", r.keyPoints, "key")}
      ${(r.details || []).length ? `<div class="rs-full"><div class="rs-full-h">Full report <span class="muted-s">${r.details.length} sections · tap to open</span></div>
        ${(r.glance || []).length ? `<details class="rs-sec"><summary>Key points</summary>${list("", r.keyPoints, "key")}</details>` : ""}
        ${r.details.map((sec) => sectionHtml(sec, { price: r.price, fv, target: r.target })).join("")}
        ${(r.forecasts || []).length ? `<details class="rs-sec"><summary>Their forecasts (summary)</summary>${list("", r.forecasts, "fc")}</details>` : ""}
        ${(r.risks || []).length ? `<details class="rs-sec"><summary>Risks (summary)</summary>${list("", r.risks, "risk")}</details>` : ""}
        ${(r.catalysts || []).length ? `<details class="rs-sec"><summary>Catalysts</summary>${list("", r.catalysts, "cat")}</details>` : ""}</div>`
      : (r.forecasts || []).length || (r.risks || []).length || (r.catalysts || []).length ? `<details class="rs-more"><summary>Forecasts, risks and catalysts</summary>
        ${list("Their forecasts", r.forecasts, "fc")}${list("Risks", r.risks, "risk")}${list("Catalysts", r.catalysts, "cat")}</details>` : ""}
    </article>`;
  }

  /* ---------- charts for the report's exhibits ----------
     Each block in a research section is a table from the report (head + rows), a list of
     points or a short text. A table with a `plot` hint is drawn as a chart, with the numbers
     one tap away. Figures marked ≈ were read off the report's chart. */
  const PAL = ["#378ADD", "#1D9E75", "#EF9F27", "#D85A30", "#7F77DD", "#888780"];
  const numOf = (c) => {
    if (c === null || c === undefined) return null;
    const s = String(c).replace(/[≈~]/g, "").replace(/[−–]/g, "-").replace(/,/g, "").replace(/^\s*(Rs|US\$|\$)\s*/i, "").trim();
    const m = s.match(/^([+-]?\d*\.?\d+)/);
    return m ? parseFloat(m[1]) : null;
  };
  const fmt = (v) => { const a = Math.abs(v); return (a >= 1000 ? App.num(v, 0) : a >= 100 ? v.toFixed(0) : v.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")); };
  const pickRows = (t, pl) => (pl.rows || t.rows.map((_, i) => i)).map((i) => t.rows[i]).filter(Boolean);
  const pickCols = (t, pl, rows) => pl.cols || t.head.map((_, j) => j).filter((j) => j > 0 && rows.filter((r) => numOf(r[j]) !== null).length >= Math.max(1, rows.length / 2));
  const legend = (t, cols, lines = []) => cols.length + lines.length > 1
    ? `<div class="ch-leg">${cols.map((j, k) => `<span><i style="background:${PAL[k % 6]}"></i>${App.esc(t.head[j])}</span>`).join("")}${lines.map((j) => `<span><i class="ln"></i>${App.esc(t.head[j])}</span>`).join("")}</div>` : "";

  function hbar(t, pl) {
    const rows = pickRows(t, pl), cols = pickCols(t, pl, rows);
    const vals = rows.flatMap((r) => cols.map((j) => numOf(r[j]))).filter((v) => v !== null);
    const max = Math.max(...vals.map(Math.abs), 1e-9), neg = vals.some((v) => v < 0);
    return legend(t, cols) + `<div class="ch-h">${rows.map((r) => `<div class="ch-hrow"><span class="ch-lab">${App.esc(String(r[0]))}</span><div class="ch-bars">${cols.map((j, k) => {
      const v = numOf(r[j]); if (v === null) return `<div class="ch-b"><span class="ch-v muted-s">–</span></div>`;
      const w = Math.abs(v) / max * (neg ? 50 : 100);
      return `<div class="ch-b"><div class="ch-trk${neg ? " mid" : ""}"><div style="width:${w.toFixed(1)}%;background:${PAL[k % 6]};${neg ? (v < 0 ? `right:50%` : `left:50%`) : "left:0"}"></div></div><span class="ch-v">${App.esc(String(r[j]).replace(/ \(.*\)$/, ""))}</span></div>`;
    }).join("")}</div></div>`).join("")}</div>`;
  }

  /* Columns over time (or a line), with an optional second-axis line (e.g. a % next to Rs).
     Labels are placed so they never overlap: period names and bar values are thinned out
     (latest kept), and each point's value goes above, below or beside it, wherever it's clear. */
  function vchart(t, pl) {
    const rows = pickRows(t, pl), cols = pickCols(t, pl, rows), lines = pl.line || [];
    const W = 360, H = 176, L = 8, R = lines.length ? 34 : 8, T = 16, B = 30, n = rows.length, cw = (W - L - R) / n, fs = 10;
    const asLine = pl.kind === "line";
    const vals = rows.flatMap((r) => cols.map((j) => numOf(r[j]))).filter((v) => v !== null);
    const stackTot = pl.stack ? rows.map((r) => cols.reduce((a, j) => a + (numOf(r[j]) || 0), 0)) : [];
    let hi = Math.max(0, ...(pl.stack ? stackTot : vals)), lo = Math.min(0, ...vals);
    if (asLine && lo >= 0) lo = Math.min(...vals) * 0.85;
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08; hi += pad; if (lo < 0) lo -= pad;
    const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
    const x = (i) => L + cw * i + cw / 2;
    let g = "";
    const pts = [];   // every point, bar and line, so labels keep clear of them
    const trace = (q) => { for (let k = 1; k < q.length; k++) { const [x1, y1] = q[k - 1], [x2, y2] = q[k], steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 5);
      for (let u = 1; u < steps; u++) pts.push({ x: x1 + (x2 - x1) * u / steps - 1.5, y: y1 + (y2 - y1) * u / steps - 1.5, w: 3, h: 3, line: true }); } };
    if (lo < 0 && !asLine) g += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--ink-soft)"/>`;
    if (asLine) cols.forEach((j, k) => {
      const p = rows.map((r, i) => [x(i), numOf(r[j]), i]).filter((q) => q[1] !== null);
      g += `<polyline fill="none" stroke="${PAL[k % 6]}" stroke-width="2" points="${p.map((q) => `${q[0].toFixed(1)},${y(q[1]).toFixed(1)}`).join(" ")}"/>`;
      p.forEach((q) => { g += `<circle cx="${q[0].toFixed(1)}" cy="${y(q[1]).toFixed(1)}" r="2.5" fill="${PAL[k % 6]}"/>`; pts.push({ x: q[0] - 3, y: y(q[1]) - 3, w: 6, h: 6, line: true }); });
      trace(p.map((q) => [q[0], y(q[1])]));
    });
    else rows.forEach((r, i) => {
      let base = 0;
      const bw = pl.stack ? cw * 0.7 : cw * 0.8 / cols.length;
      cols.forEach((j, k) => {
        const v = numOf(r[j]); if (v === null) return;
        const x0 = pl.stack ? x(i) - bw / 2 : L + cw * i + cw * 0.1 + bw * k;
        const a = pl.stack ? base : 0, b = pl.stack ? base + v : v; base = b;
        g += `<rect x="${x0.toFixed(1)}" y="${y(Math.max(a, b)).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${Math.max(0.5, Math.abs(y(a) - y(b))).toFixed(1)}" rx="1.5" fill="${PAL[k % 6]}" opacity="${/≈/.test(r[j]) ? 0.6 : 1}"/>`;
        pts.push({ x: x0, y: y(Math.max(a, b)), w: bw - 1, h: Math.max(0.5, Math.abs(y(a) - y(b))) });
      });
    });
    lines.forEach((j) => {
      const lv = rows.map((r) => numOf(r[j])).filter((v) => v !== null), lh = Math.max(...lv) * 1.1, ll = Math.min(0, ...lv);
      const y2 = (v) => T + (lh - v) / (lh - ll) * (H - T - B);
      const p = rows.map((r, i) => [x(i), numOf(r[j])]).filter((q) => q[1] !== null);
      g += `<polyline fill="none" stroke="var(--ink)" stroke-width="1.8" points="${p.map((q) => `${q[0].toFixed(1)},${y2(q[1]).toFixed(1)}`).join(" ")}"/>`;
      g += `<text x="${W - 2}" y="${T - 4}" text-anchor="end" class="ch-t">max ${fmt(lh / 1.1)}${String(rows[0][j]).includes("%") ? "%" : ""}</text>`;
      p.forEach((q) => pts.push({ x: q[0] - 2, y: y2(q[1]) - 2, w: 4, h: 4, line: true }));
      trace(p.map((q) => [q[0], y2(q[1])]));
    });
    // Values: one series only. Each label tries above, below, right, left of its point; latest first.
    if (cols.length === 1) {
      const j = cols[0];
      const idx = rows.map((_, i) => i).filter((i) => numOf(rows[i][j]) !== null);
      const order = [idx[idx.length - 1], idx[0], ...idx.slice(1, -1)].filter((v, k, arr) => v !== undefined && arr.indexOf(v) === k);
      const cands = order.map((i) => {
        const v = numOf(rows[i][j]), txt = fmt(v), w = App.textW(txt, fs), h = fs + 1, cx = x(i), cy = asLine || v >= 0 ? y(asLine ? v : v) : y(v);
        const above = { x: cx - w / 2, y: (asLine ? cy - 2 : y(Math.max(0, v))) - h - 3, w, h, txt };
        const below = { x: cx - w / 2, y: (asLine ? cy + 2 : y(Math.min(0, v))) + 3, w, h, txt };
        return (v < 0 && !asLine ? [below, above] : [above, below]).concat([{ x: cx + 4, y: cy - h - 4, w, h, txt }, { x: cx - 4 - w, y: cy - h - 4, w, h, txt },
          { x: cx + 5, y: cy - h / 2, w, h, txt }, { x: cx - 5 - w, y: cy - h / 2, w, h, txt },
          { x: cx + 4, y: cy + 4, w, h, txt }, { x: cx - 4 - w, y: cy + 4, w, h, txt }].filter(() => asLine));
      });
      const avoid = pts.filter((p) => p.line || p.h < 4);   // lines and dots; a bar's own top is where its label sits
      const pick = App.placeBoxes(cands, { avoid, W, H: H - B + 2 });
      cands.forEach((c, k) => { if (pick[k] >= 0) { const b = c[pick[k]]; g += `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y + b.h - 2).toFixed(1)}" text-anchor="middle" class="ch-t">${b.txt}</text>`; } });
    }
    // Period names along the bottom: drop any that would touch (first and last kept).
    const names = rows.map((r) => String(r[0]).replace(/^12 months to /, "TTM ").replace(/^([A-Z][a-z]{2}) 20(\d\d)$/, "$1 $2"));
    const keep = App.fitLabels(names.map((nm, i) => ({ x: x(i), w: App.textW(nm, fs), prio: i === n - 1 ? 3 : i === 0 ? 2 : 1 })), 5);
    names.forEach((nm, i) => { if (keep.has(i)) g += `<text x="${x(i).toFixed(1)}" y="${H - B + 14}" text-anchor="middle" class="ch-t">${App.esc(nm)}</text>`; });
    return legend(t, cols, lines) + `<svg class="ch-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${App.esc(t.title)}">${g}</svg>`;
  }

  /* Start, steps up or down, end (subtotal rows start with "="). */
  function waterfall(t, pl) {
    const j = (pl.cols || [1])[0], rows = t.rows;
    let run = 0; const bars = rows.map((r, i) => {
      const lab = String(r[0]), v = numOf(r[j]);
      const total = i === 0 || i === rows.length - 1 || /^=/.test(lab);
      const sign = /^[−-]/.test(lab) ? -1 : 1;
      if (total) { run = v; return { lab, a: 0, b: v, total: true, v }; }
      const d = /^[−-]|^\+/.test(lab) ? sign * Math.abs(v) : v; const a = run; run += d; return { lab, a, b: run, d };
    });
    const hi = Math.max(...bars.map((b) => Math.max(b.a, b.b))), W = 360, rowH = 22;
    const x = (v) => 4 + v / hi * 150;
    return `<svg class="ch-svg" viewBox="0 0 ${W} ${bars.length * rowH + 4}" role="img" aria-label="${App.esc(t.title)}">${bars.map((b, i) => {
      const yy = 2 + i * rowH, c = b.total ? "#378ADD" : b.d < 0 ? "#E24B4A" : "#1D9E75";
      return `<rect x="${x(Math.min(b.a, b.b)).toFixed(1)}" y="${yy}" width="${Math.max(1.5, Math.abs(x(b.b) - x(b.a))).toFixed(1)}" height="${rowH - 7}" rx="2" fill="${c}"/>
        <text x="162" y="${yy + 12}" class="ch-t">${App.esc(b.lab.replace(/^[=+−-]\s*/, ""))} <tspan font-weight="600">${b.total ? fmt(b.v) : (b.d < 0 ? "−" : "+") + fmt(Math.abs(b.d))}</tspan></text>`;
    }).join("")}</svg>`;
  }

  function heatmap(t) {
    const vals = t.rows.flatMap((r) => r.slice(1).map(numOf)).filter((v) => v !== null), lo = Math.min(...vals), hi = Math.max(...vals);
    const bg = (v) => `hsla(${Math.round(10 + (v - lo) / (hi - lo || 1) * 120)},60%,55%,0.35)`;
    return `<div class="table-wrap"><table class="grid ch-heat"><thead><tr>${t.head.map((h) => `<th>${App.esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr><th>${App.esc(r[0])}</th>${r.slice(1).map((c) => `<td style="background:${bg(numOf(c))}">${App.esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  /* Low–high bars per method, with today's price, this site's value and their target marked. */
  function rangeChart(t, ctx) {
    const marks = [["price", "Price", ctx.price], ["fv", "This site", ctx.fv], ["tg", "Target", ctx.target]].filter((m) => App.isNum(m[2]));
    const all = t.rows.flatMap((r) => [numOf(r[1]), numOf(r[2])]).concat(marks.map((m) => m[2]));
    const hi = Math.max(...all) * 1.04, x = (v) => (v / hi * 100).toFixed(1);
    return `<div class="ch-range">${t.rows.map((r) => { const a = numOf(r[1]), b = numOf(r[2]);
      return `<div class="ch-rrow"><span class="ch-lab">${App.esc(r[0])}</span><div class="ch-rtrk"><div class="ch-rbar" style="left:${x(a)}%;width:${(x(b) - x(a)).toFixed(1)}%"></div>
        ${marks.map((m) => `<i class="ch-rmk ${m[0]}" style="left:${x(m[2])}%"></i>`).join("")}</div><span class="ch-v">${fmt(a)}–${fmt(b)}</span></div>`; }).join("")}
      <div class="ch-leg">${marks.map((m) => `<span><i class="ch-rk ${m[0]}"></i>${m[1]} ${fmt(m[2])}</span>`).join("")}</div></div>`;
  }

  function riskgrid(t) {
    const LV = ["Low", "Medium", "High", "Very high"], at = {};
    t.rows.forEach((r) => { const k = `${r[3]}|${r[2]}`; (at[k] = at[k] || []).push(r[0]); });
    const col = (i, l) => ["#EAF3DE", "#C0DD97", "#FAC775", "#F09595"][Math.min(3, Math.floor((i + l) / 2))];
    return `<div class="ch-risk"><span></span>${LV.map((l) => `<span class="muted-s">${l}</span>`).join("")}
      ${LV.slice().reverse().map((imp, ii) => `<span class="muted-s">${imp}</span>${LV.map((lik, li) => `<span style="background:${col(3 - ii, li)}">${(at[`${imp}|${lik}`] || []).join(" ")}</span>`).join("")}`).join("")}</div>
      <p class="muted-s">Across: likelihood. Down: impact.</p>
      <ul class="ch-risk-l">${t.rows.map((r) => `<li><b>${App.esc(r[0])}</b> ${App.esc(r[1])}</li>`).join("")}</ul>`;
  }

  /* Each name goes right, left, above or below its dot, wherever it doesn't hit another
     name or dot; a name with no clear spot is left off (it's still in Numbers). */
  function scatter(t) {
    const pts = t.rows.map((r) => ({ n: String(r[0]), y: numOf(r[1]), x: numOf(r[2]) })).filter((p) => p.x !== null && p.y !== null);
    const W = 360, H = 220, fs = 10, mx = Math.max(...pts.map((p) => p.x)) * 1.08, my = Math.max(...pts.map((p) => p.y)) * 1.12;
    const X = (v) => 32 + v / mx * (W - 44), Y = (v) => H - 26 - v / my * (H - 40);
    const dots = pts.map((p) => ({ x: X(p.x) - 5, y: Y(p.y) - 5, w: 10, h: 10 }));
    const cands = pts.map((p) => { const w = App.textW(p.n, fs), h = fs + 2, cx = X(p.x), cy = Y(p.y);
      return [{ x: cx + 7, y: cy - h / 2, w, h }, { x: cx - 7 - w, y: cy - h / 2, w, h }, { x: cx - w / 2, y: cy - h - 6, w, h }, { x: cx - w / 2, y: cy + 6, w, h }]; });
    const pick = App.placeBoxes(cands, { avoid: dots.concat([{ x: 0, y: H - 24, w: W, h: 24 }, { x: 30, y: 0, w: 140, h: 16 }]), W, H });
    return `<svg class="ch-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${App.esc(t.title)}">
      <line x1="30" y1="${H - 26}" x2="${W - 6}" y2="${H - 26}" stroke="var(--ink-soft)"/><line x1="30" y1="6" x2="30" y2="${H - 26}" stroke="var(--ink-soft)"/>
      <text x="${W - 6}" y="${H - 10}" text-anchor="end" class="ch-t">${App.esc(t.head[2])} →</text><text x="34" y="12" class="ch-t">↑ ${App.esc(t.head[1])}</text>
      ${pts.map((p, i) => { const b = pick[i] >= 0 ? cands[i][pick[i]] : null;
        return `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${i === 0 ? 6 : 4}" fill="${i === 0 ? "#D85A30" : "#85B7EB"}"><title>${App.esc(p.n)}</title></circle>` +
          (b ? `<text x="${b.x.toFixed(1)}" y="${(b.y + b.h - 3).toFixed(1)}" class="ch-t"${i === 0 ? ' font-weight="600"' : ""}>${App.esc(p.n)}</text>` : ""); }).join("")}</svg>
      ${pick.some((k) => k < 0) ? `<p class="muted-s">Some names are left off where dots crowd together; tap Numbers for all of them.</p>` : ""}`;
  }

  function numbersTable(t) {
    return `<div class="table-wrap grid-wrap"><table class="grid"><thead><tr>${t.head.map((h, i) => `<th${i ? ' class="num"' : ""}>${App.esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${t.rows.map((row) => `<tr>${row.map((c, i) => `<td${i && /^[≈~]?\s*(Rs\s)?[−+\-]?[\d.,]+\s?(x|%|bn|mn)?(\s\(.*\))?$|^[\d.,]+ : [\d.,]+$/.test(String(c)) ? ' class="num"' : ""}>${App.esc(String(c))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function blockHtml(b, ctx) {
    const head = `<div class="rs-tbl-h">${App.esc(b.title || "")}</div>`;
    const foot = `${b.note ? `<p class="ch-note">${App.esc(b.note)}</p>` : ""}${b.approx ? `<p class="muted-s">≈ read from the report's chart.</p>` : ""}`;
    if (b.points) return `<div class="rs-blk">${head}<ul>${b.points.map((x) => `<li>${App.esc(x)}</li>`).join("")}</ul></div>`;
    if (!b.rows) return `<div class="rs-blk">${head}<p class="ch-note">${App.esc(b.text || "")}</p>${b.approx ? `<p class="muted-s">≈ read from the report's chart.</p>` : ""}</div>`;
    const pl = b.plot || { kind: "none" };
    let chart = "";
    try {
      chart = { hbar: hbar, vbar: vchart, line: vchart, waterfall: waterfall, heatmap: heatmap, range: (t) => rangeChart(t, ctx), riskgrid: riskgrid, scatter: scatter }[pl.kind]?.(b, pl) || "";
    } catch (e) { chart = ""; }
    const own = pl.kind === "heatmap" || pl.kind === "riskgrid";
    return `<div class="rs-blk">${head}${chart || numbersTable(b)}${foot}${chart && !own ? `<details class="ch-nums"><summary>Numbers</summary>${numbersTable(b)}</details>` : ""}</div>`;
  }

  /* One section of a long research report: short points, then each exhibit as a chart or table. */
  function sectionHtml(sec, ctx) {
    const n = (sec.tables || []).length;
    return `<details class="rs-sec"><summary><span class="rs-sec-t">${App.esc(sec.title)}${sec.pages ? `<small>p. ${App.esc(sec.pages)}${n ? ` · ${n} charts and tables` : ""}</small>` : ""}</span></summary>
      ${(sec.points || []).length ? `<ul>${sec.points.map((x) => `<li>${App.esc(x)}</li>`).join("")}</ul>` : ""}
      ${(sec.tables || []).map((b) => blockHtml(b, ctx)).join("")}</details>`;
  }

  /* "What was read": every item in every report, and whether it made it into the summary. */
  function coverageHtml(cov) {
    const ST = { included: ["✓", "In the summary"], approx: ["≈", "Approximate (read from a chart)"], "left-out": ["✗", "Left out"] };
    const all = cov.flatMap((c) => c.items || []);
    const n = (k) => all.filter((i) => i.status === k).length;
    return `<details class="more cov" id="bk-cov"><summary>What's in this summary: ${cov.length} posts, ${all.length} items (${n("included")} ✓ in · ${n("approx")} ≈ approx · ${n("left-out")} ✗ left out)</summary>
      ${cov.map((c) => `<div class="cov-post"><h4>${App.esc(c.title || "Post " + c.post)} <span class="muted-s">post ${App.esc(String(c.post))}${c.kind ? ` · ${App.esc(c.kind)}` : ""}</span></h4>
        <ul>${(c.items || []).map((i) => `<li class="cov-${i.status}"><span class="cov-st" title="${(ST[i.status] || ["?", ""])[1]}">${(ST[i.status] || ["?"])[0]}</span>
          <span>${App.esc(i.item)}${i.reason ? ` <em class="muted-s">(${App.esc(i.reason)})</em>` : ""}</span></li>`).join("")}</ul></div>`).join("")}
    </details>`;
  }

  /* ---------- page ---------- */
  function render(d) {
    const m = d.market || {};
    const calls = d.calls || [];
    sub.textContent = `${d.source || "Broker"} · ${d.posts ? d.posts + " messages" : ""}${d.callsPriceDate ? ` · call prices as of ${App.date(d.callsPriceDate)}` : ""}`;

    const sectors = [...new Set(calls.map((c) => c.sector).filter(Boolean))].sort();
    const ratings = [...new Set(calls.map((c) => c.rating).filter(Boolean))];

    const flows = (m.foreignFlows || []).slice().sort((a, b) => a.mn - b.mn);
    const flowsApprox = flows.some((f) => f.approx);
    const research = d.research || [];
    const other = m.other || [];
    const maxFlow = Math.max(1, ...flows.map((f) => Math.abs(f.mn)));
    const news = d.news || [];
    const NEWS_SHOWN = 4;
    const pctBars = (items, raw) => { const mx = Math.max(...items.map((i) => Math.abs(i[1])), 1e-9);
      return `<div class="${raw ? "flow-w" : ""}">` + items.map(([lab, v]) => `<div class="flow"><span>${raw ? lab : App.esc(lab)}</span><div class="flow-bar"><div class="${v < 0 ? "neg" : "pos"}" style="width:${(Math.abs(v) / mx * 50).toFixed(1)}%"></div></div><span class="num ${v < 0 ? "down" : "up"}">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%</span></div>`).join("") + "</div>"; };
    const codeChips = (codes, cls) => (codes || []).map((c) => `<span class="badge ${cls}">${App.esc(c)}</span>`).join("");

    /* Jump nav: skip straight to a section on a long day. */
    const jump = [
      (d.highlights || []).length && ["#bk-highlights", "In short"],
      research.length && ["#bk-research", "Research"],
      calls.length && ["#bk-calls", "All calls"],
      (d.dividends || []).length && ["#bk-dividends", "Dividends"],
      (flows.length || (m.momentum || []).length || other.length) && ["#bk-market", "Market details"],
      news.length && ["#bk-news", "News"],
      (d.coverage || []).length && ["#bk-cov", "What's included"],
    ].filter(Boolean);

    content.innerHTML = `
      <div class="tiles">
        ${App.isNum(m.aspi) ? tile("ASPI", App.num(m.aspi, 0), pct(m.aspiChangePct, 2), m.aspiChangePct >= 0 ? "up" : "down") : ""}
        ${App.isNum(m.sp20) ? tile("S&amp;P SL20", App.num(m.sp20, 0), pct(m.sp20ChangePct, 2), m.sp20ChangePct >= 0 ? "up" : "down") : ""}
        ${App.isNum(m.turnoverBn) ? tile("Turnover", `Rs ${m.turnoverBn}bn`, App.isNum(m.marketPE) ? `Market P/E ${m.marketPE}x · P/B ${m.marketPBV}x` : "") : ""}
        ${App.isNum(m.foreignNetMn) ? tile("Foreign investors", `${m.foreignNetMn < 0 ? "−" : "+"}Rs ${Math.abs(Math.round(m.foreignNetMn))}mn`, (App.isNum(m.foreignBuyMn) && App.isNum(m.foreignSellMn) ? `Bought Rs ${App.num(m.foreignBuyMn, 0)}mn · sold Rs ${App.num(m.foreignSellMn, 0)}mn` : (m.foreignNetMn < 0 ? "Net sellers" : "Net buyers")), m.foreignNetMn < 0 ? "down" : "up") : ""}
      </div>

      ${jump.length > 2 ? `<nav class="more-jump">${jump.map(([href, label]) => `<a href="${href}">${App.esc(label)}</a>`).join("")}</nav>` : ""}

      ${(d.highlights || []).length ? `<section class="bk-card" id="bk-highlights"><h2>Today in short</h2>
        ${typeof d.highlights[0] === "string"
          ? `<ul class="bk-list hl">${d.highlights.map((h) => `<li tabindex="0">${App.esc(h)}</li>`).join("")}</ul><p class="muted-s hl-hint">Tap a point to read it all.</p>`
          : `<div class="hl2">${d.highlights.map((h) => `<details class="hl2-row"><summary><span class="hl2-ic ${App.esc(h.tone || "info")}" aria-hidden="true">${App.esc(h.icon || "•")}</span>
              <span class="hl2-t">${App.esc(h.title)}</span>${h.figure ? `<b class="hl2-f ${h.tone === "down" ? "down" : h.tone === "up" ? "up" : ""}">${App.esc(h.figure)}</b>` : ""}</summary>
              <p>${App.esc(h.text || "")}</p></details>`).join("")}</div><p class="muted-s hl-hint">Tap a line for the detail.</p>`}</section>` : ""}

      ${research.length ? `<section class="bk-card" id="bk-research"><h2>Broker research</h2><div class="rs-grid">${research.map(researchCard).join("")}</div></section>` : ""}

      ${calls.length ? `<section class="bk-card" id="bk-calls">
        <div class="bk-head"><h2>All broker calls <span class="muted-s" id="count"></span></h2>
          <div class="filters">
            <input type="search" id="q" class="search" placeholder="Search company or code" aria-label="Search calls">
            <div class="rate-chips" id="frc" role="group" aria-label="Filter by call"><button type="button" class="on" data-r="">All</button>${ratings.map((r) => `<button type="button" data-r="${App.esc(r)}">${App.esc(r)}</button>`).join("")}</div>
            <select id="fs" aria-label="Filter by sector"><option value="">All sectors</option>${sectors.map((s) => `<option>${App.esc(s)}</option>`).join("")}</select>
          </div></div>
        <div class="call-head"><span>Price</span><span>Target</span><span>Upside</span></div>
        <div class="call-list" id="rows"></div>
        <button type="button" class="show-all" id="callsAll" hidden></button>
        <p class="muted-s">Sorted by the broker's upside. ★ marks companies on this site.</p>
      </section>` : ""}

      <div class="bk-grid">
        ${(d.dividends || []).length ? `<section class="bk-card" id="bk-dividends"><h2>Coming dividends</h2>
          <ul class="div-list">${d.dividends.map((v) => `<li><b>${App.esc(v.name.replace(/ (PLC|Limited)$/i, ""))}</b> <span class="muted-s">${App.esc(v.code.split(".")[0])}</span>
            <div>${App.price(v.dps)}${v.type ? ` ${App.esc(v.type.toLowerCase())}` : ""}${App.isNum(v.yieldPct) ? ` · ${v.yieldPct.toFixed(1)}% yield` : ""} · XD ${App.date(v.xd)} · paid ${App.date(v.pay)}</div></li>`).join("")}</ul></section>` : ""}

        ${flows.length || (m.momentum || []).length || other.length || (m.world || []).length ? `<section class="bk-card" id="bk-market"><details class="bk-fold"><summary><h2>Market details</h2><span class="muted-s">foreign flows, momentum, heat map, world markets</span></summary>
          ${flows.length ? `<h3 class="bk-sub">Foreign buying and selling by share (Rs mn)</h3>
          ${flows.map((f) => `<div class="flow"><span>${App.esc(f.code.split(".")[0])}</span><div class="flow-bar"><div class="${f.mn < 0 ? "neg" : "pos"}" style="width:${(Math.abs(f.mn) / maxFlow * 50).toFixed(1)}%"></div></div><span class="num">${f.approx ? "≈" : ""}${f.mn > 0 ? "+" : f.mn < 0 ? "−" : ""}${Math.abs(f.mn)}</span></div>`).join("")}
          ${flowsApprox ? `<p class="muted-s">≈ read from the broker's chart, which has no figures on the bars.</p>` : ""}` : ""}
          ${other.length ? `<h3 class="bk-sub">Other figures</h3><dl class="bk-other">${other.map((o) => `<div><dt>${App.esc(o.label)}</dt><dd>${App.esc(String(o.value))}${o.unit ? ` ${App.esc(o.unit)}` : ""}</dd></div>`).join("")}</dl>` : ""}
          ${(m.gainers || []).length ? `<div class="chip-line"><b>Lifted the index</b><div class="badges">${codeChips(m.gainers, "good")}</div></div>` : ""}
          ${(m.losers || []).length ? `<div class="chip-line"><b>Held it back</b><div class="badges">${codeChips(m.losers, "bad")}</div></div>` : ""}
          ${(m.momentum || []).length ? `<h3 class="bk-sub">Biggest 10-day rises</h3>${pctBars(m.momentum.map((x) => [x.code.split(".")[0], x.pct]))}` : ""}
          ${(m.heatmap || []).length ? `<h3 class="bk-sub">Notable moves today (%)</h3><div class="heat">${m.heatmap.slice().sort((a, b) => a.pct - b.pct).map((h) => `<span style="background:${h.pct < 0 ? `rgba(226,75,74,${(0.15 + Math.min(1, -h.pct / 6) * 0.6).toFixed(2)})` : `rgba(29,158,117,${(0.15 + Math.min(1, h.pct / 6) * 0.6).toFixed(2)})`}">${App.esc(h.code)} ${h.pct > 0 ? "+" : "−"}${Math.abs(h.pct).toFixed(2)}</span>`).join("")}</div>` : ""}
          ${(m.world || []).length ? `<h3 class="bk-sub">World markets</h3>${pctBars(m.world.map((w) => [w.name + (w.asOf ? ` <small>${App.esc(w.asOf)}</small>` : ""), w.pct]), true)}` : ""}
        </details></section>` : ""}
      </div>

      ${news.length ? `<section class="bk-card" id="bk-news"><h2>News and views <span class="muted-s">${news.length} · tap a headline</span></h2>
        <div class="news-list">${news.map((n) => `<details class="news1"><summary>${App.esc(n.title)}</summary><p>${App.esc(n.text)}</p></details>`).join("")}</div>
      </section>` : ""}

      ${(d.coverage || []).length ? coverageHtml(d.coverage) : ""}

      ${d.note ? (d.note.length > 220
          ? `<details class="more"><summary>Notes on this summary</summary><p class="muted-s">${App.esc(d.note)}</p></details>`
          : `<p class="muted-s">${App.esc(d.note)}</p>`) : ""}`;

    content.querySelectorAll(".bk-list.hl li").forEach((li) => li.addEventListener("click", () => li.classList.toggle("open")));
    /* Filterable, sorted table of every call. */
    if (!calls.length) return;
    const rowsEl = document.getElementById("rows"), countEl = document.getElementById("count");
    const q = document.getElementById("q"), frc = document.getElementById("frc"), fs = document.getElementById("fs"), allBtn = document.getElementById("callsAll");
    const fr = { value: "" }; let showAll = false; const FIRST = 12;
    frc.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; fr.value = b.dataset.r;
      frc.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
    allBtn.addEventListener("click", () => { showAll = !showAll; draw(); });
    const sorted = calls.slice().sort((a, b) => (upside(b) ?? -999) - (upside(a) ?? -999));
    function draw() {
      const term = q.value.trim().toLowerCase();
      const shown = sorted.filter((c) => (!fr.value || c.rating === fr.value) && (!fs.value || c.sector === fs.value)
        && (!term || (c.name + " " + c.code).toLowerCase().includes(term)));
      countEl.textContent = `(${shown.length} of ${calls.length})`;
      const filtering = term || fr.value || fs.value;
      allBtn.hidden = filtering || shown.length <= FIRST;
      allBtn.textContent = showAll ? "Show fewer" : `Show all ${shown.length}`;
      const visible = filtering || showAll ? shown : shown.slice(0, FIRST);
      const n = (v) => (App.isNum(v) ? (v >= 100 ? App.num(v, 0) : v.toFixed(2)) : "–");
      rowsEl.innerHTML = visible.map((c) => {
        const u = upside(c), co = mine[c.code];
        const nm = c.name.replace(/ (PLC|Limited)$/i, "");
        const name = co ? `<a href="company.html?t=${encodeURIComponent(co.ticker)}">★ ${App.esc(nm)}</a>` : App.esc(nm);
        return `<div class="call1"><div class="call1-top"><span class="call1-name">${name} <span class="muted-s">${App.esc(c.code.split(".")[0])}${c.code.includes(".X") ? " NV" : ""}</span></span>${chip(c.rating)}</div>
          <div class="call1-nums"><span>${n(c.price)}</span><span>${App.isNum(c.target) ? n(c.target) : "not set"}</span><span class="${u !== null && u < 0 ? "down" : "up"}">${pct(u)}</span></div>
          ${co && co.valuation && App.isNum(co.valuation.fairValue) ? `<div class="call1-dl">${dotLine([["price", "Price", c.price], ["fv", "This site", co.valuation.fairValue], ["tg", "Target", c.target]], true)}<span class="muted-s">this site ${n(co.valuation.fairValue)}</span></div>` : ""}</div>`;
      }).join("") || `<p class="muted-s">No calls match.</p>`;
    }
    [q, fs].forEach((el) => el.addEventListener("input", draw));
    draw();
  }

  show(pos);
})();
