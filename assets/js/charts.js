/* Small SVG charts drawn without any library, so nothing external can break. */
"use strict";

const Charts = {};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
function niceTicks(min, max, count = 6) {
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/* ---------- Price ladder: zones from strong-buy to above fair value ----------
   Drawn at the size it's shown (one SVG unit = one pixel), so text stays readable on a phone.
   Level labels that would overlap move to a second row. */
/* A thin outline in the page colour behind text, so a line passing behind it never cuts through it. */
const HALO = `stroke="var(--surface)" stroke-width="3" paint-order="stroke" stroke-linejoin="round"`;
const widthOf = (el, min = 320) => Math.max(min, Math.round(el.clientWidth || el.parentElement?.clientWidth || 1000));
Charts.ladder = function (el, { price, strongBuy, buy, fair, extra = [], targets = [] }) {
  const vals = [price, strongBuy, buy, fair, ...extra, ...targets.map((t) => t.price)].filter(App.isNum);
  if (!App.isNum(fair) || vals.length < 2) { el.innerHTML = '<p class="na">Not enough valuation levels to draw the price ladder.</p>'; return; }
  const lo = Math.min(...vals) * 0.8, hi = Math.max(...vals) * 1.1;
  const W = widthOf(el), L = 4, R = W - 4, barY = 34, barH = 24, fs = 12;
  const x = scale(lo, hi, L, R);
  const zones = [
    [lo, App.isNum(strongBuy) ? strongBuy : lo, "--zone-strong"],
    [App.isNum(strongBuy) ? strongBuy : lo, App.isNum(buy) ? buy : lo, "--zone-buy"],
    [App.isNum(buy) ? buy : lo, fair, "--zone-fair"],
    [fair, hi, "--zone-over"],
  ];
  // Level labels: two lines each ("Buy" / "Rs 24.69"), stacked into rows when they'd overlap.
  const levels = [[strongBuy, "Strong buy"], [buy, "Buy"], [fair, "Fair value"]].filter(([v]) => App.isNum(v));
  const lv = levels.map(([v, t]) => ({ x: Math.min(Math.max(x(v), 40), W - 40), w: Math.max(App.textW(t, fs), App.textW(App.rs(v), fs)) }));
  const dodged = App.dodge(lv, W, 10);
  const lvRow = dodged ? lv.map(() => 0) : App.stackLabels(lv, 8), rowH = 32;
  if (dodged) dodged.forEach((c, i) => { lv[i].x = c; });
  const levelsBottom = barY + barH + 22 + (Math.max(0, ...lvRow) + 1) * rowH;
  const tg = targets.filter((t) => App.isNum(t.price));
  const tgItems = tg.map((t) => ({ x: Math.min(Math.max(x(t.price), 60), W - 60), w: App.textW(`▲ Alert ${App.rs(t.price)}${t.fired ? " (sent)" : ""}`, fs) }));
  const tgRow = App.stackLabels(tgItems, 8);
  const H = levelsBottom + (tg.length ? (Math.max(0, ...tgRow) + 1) * 18 + 6 : 0);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price ${App.price(price)} compared with strong-buy ${App.rs(strongBuy)}, buy ${App.rs(buy)} and fair value ${App.rs(fair)}">`;
  zones.forEach(([a, b, c], i) => {
    if (b <= a) return;
    s += `<rect x="${x(a)}" y="${barY}" width="${x(b) - x(a)}" height="${barH}" fill="${css(c)}" rx="${i === 0 ? 6 : 0}"/>`;
  });
  [["Strong buy", lo, strongBuy], ["Buy", strongBuy, buy], ["Fair", buy, fair], ["Above fair value", fair, hi]].forEach(([t, a, b]) => {
    if (!App.isNum(a) || !App.isNum(b) || x(b) - x(a) < App.textW(t, 11) + 8) return;
    const tw = App.textW(t, 11) / 2 + 6, mid = (x(a) + x(b)) / 2;
    if (App.isNum(price) && Math.abs(x(price) - mid) < tw) return;   // today's marker would cut through it
    s += `<text x="${(x(a) + x(b)) / 2}" y="${barY + 16}" text-anchor="middle" font-size="11" fill="${css("--ink-soft")}">${t}</text>`;
  });
  levels.forEach(([v, t], i) => {
    const ty = barY + barH + 22 + lvRow[i] * rowH;   // label top
    // Leader: straight down from the level, then across to where its label had to move.
    s += `<polyline pathLength="1" fill="none" points="${x(v)},${barY} ${x(v)},${barY + barH + 6} ${lv[i].x},${ty - 2}" stroke="${css("--ink")}" stroke-width="1.2"/>` +
      `<text x="${lv[i].x}" y="${ty + 9}" text-anchor="middle" font-size="${fs}" fill="${css("--ink-soft")}" ${HALO}>${t}</text>` +
      `<text x="${lv[i].x}" y="${ty + 24}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${css("--ink")}" ${HALO}>${App.rs(v)}</text>`;
  });
  tg.forEach((t, i) => {
    const tx = x(t.price), ly = levelsBottom + 12 + tgRow[i] * 18, color = t.fired ? css("--ink-soft") : css("--warn");
    s += `<line x1="${tx}" x2="${tx}" y1="${barY + barH}" y2="${ly - 11}" stroke="${color}" stroke-width="1.2" stroke-dasharray="3 3"/>` +
      `<text x="${tgItems[i].x}" y="${ly}" text-anchor="middle" font-size="${fs}" fill="${color}">${t.direction === "below" ? "▼" : "▲"} Alert ${App.rs(t.price)}${t.fired ? " (sent)" : ""}</text>`;
  });
  if (App.isNum(price)) {
    const px = x(price), label = `Today ${App.price(price)}`, half = App.textW(label, 14) / 2 + 2;
    s += `<line x1="${px}" x2="${px}" y1="${barY - 8}" y2="${barY + barH + 2}" stroke="${css("--accent")}" stroke-width="3.5" stroke-linecap="round"/>` +
      `<text x="${Math.min(Math.max(px, half), W - half)}" y="${barY - 13}" text-anchor="middle" font-size="14" font-weight="600" fill="${css("--accent")}">${label}</text>`;
  }
  el.innerHTML = s + "</svg>";
};

/* Thin version for home-page cards (HTML, no labels). */
Charts.mini = function ({ price, strongBuy, buy, fair }) {
  const vals = [price, strongBuy, buy, fair].filter(App.isNum);
  if (!App.isNum(fair) || !App.isNum(price)) return "";
  const lo = Math.min(...vals) * 0.8, hi = Math.max(...vals) * 1.1;
  const pc = (v) => ((v - lo) / (hi - lo)) * 100;
  const sb = App.isNum(strongBuy) ? strongBuy : lo, b = App.isNum(buy) ? buy : sb;
  const seg = (a, z, c) => `<span style="width:${pc(z) - pc(a)}%;background:var(${c})"></span>`;
  // Buy and fair value as labelled ticks under the bar; today's price as a pulsing dot on it.
  const ticks = [[b, "Buy"], [fair, "Fair"]].filter(([x]) => App.isNum(x));
  const zone = price <= sb ? "strong" : price <= b ? "buy" : price <= fair ? "fair" : "over";
  return `<div class="mini-wrap m2" aria-hidden="true"><div class="mini">${seg(lo, sb, "--zone-strong")}${seg(sb, b, "--zone-buy")}${seg(b, fair, "--zone-fair")}${seg(fair, hi, "--zone-over")}</div>` +
    `<span class="mini-dot ${zone}" style="left:${pc(price)}%"></span>` +
    `<div class="mini-ticks">${ticks.map(([x, t], k) => {
      // When Buy and Fair sit close together their labels splay outwards (Buy to the left of its
      // tick, Fair to the right) so they never overlap; labels near an edge hug that edge.
      const close = ticks.length === 2 && Math.abs(pc(ticks[1][0]) - pc(ticks[0][0])) < 26;
      const p = pc(x), side = close ? (k === 0 ? "l" : "r") : p < 12 ? "r" : p > 88 ? "l" : "";
      return `<span class="${side}" style="left:${p}%"><i></i>${t} <b>${App.num(x, x >= 100 ? 0 : 2)}</b></span>`; }).join("")}</div></div>`;
};

/* ---------- Valuation methods: bear–bull range per method ----------
   Wide screens: names on the left. Narrow screens: each name on its own line above its range,
   so the names never run into the chart. The base value sits beside the range, not on top of it. */
Charts.models = function (el, models, { price, fair }) {
  const rows = models.filter((m) => App.isNum(m.bear) && App.isNum(m.bull));
  if (!rows.length) { el.innerHTML = '<p class="na">Not available in this analysis.</p>'; return; }
  const vals = rows.flatMap((m) => [m.bear, m.base, m.bull, m.weighted]).concat([price, fair]).filter(App.isNum);
  const lo = Math.max(0, Math.min(...vals) * 0.85), hi = Math.max(...vals) * 1.08;
  const W = widthOf(el), narrow = W < 640, fs = 12;
  const labelW = narrow ? 8 : Math.min(260, Math.max(...rows.map((m) => App.textW(m.name, 13))) + 16);
  const rowH = narrow ? 58 : 50;
  const ink = css("--ink"), soft = css("--ink-soft"), rule = css("--rule");
  // Fair value and today's price labels across the top: a second row if they'd overlap.
  const lines = [[fair, "Fair value", ink], [price, "Today", css("--accent")]].filter(([v]) => App.isNum(v));
  const x = scale(lo, hi, labelW + 6, W - 34);
  const top0 = lines.map(([v, t]) => ({ x: Math.min(Math.max(x(v), App.textW(`${t} ${App.num(v)}`, fs) / 2), W - App.textW(`${t} ${App.num(v)}`, fs) / 2), w: App.textW(`${t} ${App.num(v)}`, fs) }));
  const topRow = App.stackLabels(top0, 8), top = 14 + (Math.max(0, ...topRow) + 1) * 16;
  const H = top + rows.length * rowH + 26;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bear, base and bull value for each valuation method">`;
  const ticks = niceTicks(lo, hi, narrow ? 4 : 6), tk = App.fitLabels(ticks.map((t) => ({ x: x(t), w: App.textW(App.num(t), fs) })), 10);
  ticks.forEach((t, i) => {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - 22}" stroke="${rule}"/>` +
      (tk.has(i) ? `<text x="${x(t)}" y="${H - 6}" text-anchor="middle" font-size="${fs}" fill="${soft}">${App.num(t)}</text>` : "");
  });
  // Labels: the base value goes just above its dot; the bear and bull values sit, smaller, outside
  // the two ends of the range. Each tries a few spots and is left off rather than drawn over
  // another label, a dot or the method's name (the values are also in the table and on hover).
  const placed = [];
  const box = (x0, y0, w, h) => ({ x: x0, y: y0, w, h });
  const put = (cands) => { const k = App.placeBoxes([cands], { avoid: placed, W, H })[0]; if (k < 0) return null; placed.push(cands[k]); return cands[k]; };
  rows.forEach((m, i) => {
    const y = top + i * rowH + (narrow ? 34 : rowH / 2);
    const nameW = App.textW(m.name, 13);
    s += narrow ? `<text x="0" y="${y - 16}" font-size="13" fill="${ink}" ${HALO}>${App.esc(m.name)}</text>`
      : `<text x="0" y="${y + 5}" font-size="13" fill="${ink}">${App.esc(m.name)}</text>`;
    placed.push(narrow ? box(0, y - 29, nameW, 16) : box(0, y - 8, nameW, 16));
    s += `<line x1="${x(m.bear)}" x2="${x(m.bull)}" y1="${y}" y2="${y}" stroke="${soft}" stroke-width="6" stroke-linecap="round" opacity="0.35"/>`;
    s += `<circle cx="${x(m.bear)}" cy="${y}" r="5.5" fill="${css("--bad")}"><title>Bear ${App.rs(m.bear)}</title></circle>`;
    s += `<circle cx="${x(m.bull)}" cy="${y}" r="5.5" fill="${css("--good")}"><title>Bull ${App.rs(m.bull)}</title></circle>`;
    [m.bear, m.bull, m.base].filter(App.isNum).forEach((v) => placed.push(box(x(v) - 8, y - 8, 16, 16)));
    if (App.isNum(m.weighted)) {
      const wx = x(m.weighted);
      s += `<path d="M${wx} ${y + 8} l6 7 l-6 7 l-6 -7 z" fill="${css("--accent")}"><title>Weighted ${App.rs(m.weighted)}</title></path>`;
      placed.push(box(wx - 7, y + 7, 14, 16));
    }
    if (App.isNum(m.base)) {
      s += `<circle cx="${x(m.base)}" cy="${y}" r="7.5" fill="${ink}"><title>Base ${App.rs(m.base)}</title></circle>`;
      const t = App.num(m.base), tw = App.textW(t, fs), bx = x(m.base);
      const b = put([box(bx - tw / 2, y - 24, tw, 14), box(bx + 11, y - 21, tw, 14), box(bx - 11 - tw, y - 21, tw, 14), box(bx + 11, y + 6, tw, 14)]);
      if (b) s += `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y + 11).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${ink}" ${HALO}>${t}</text>`;
    }
    const ends = [[Math.min(m.bear, m.bull), m.bear <= m.bull ? "--bad" : "--good", "end"], [Math.max(m.bear, m.bull), m.bear <= m.bull ? "--good" : "--bad", "start"]];
    ends.forEach(([v, col, side]) => {
      const t = App.num(v), tw = App.textW(t, 11), ex = x(v);
      const b = put(side === "end" ? [box(ex - 10 - tw, y - 7, tw, 13)] : [box(ex + 10, y - 7, tw, 13)]);
      if (b) s += `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y + 10).toFixed(1)}" text-anchor="middle" font-size="11" fill="${css(col)}" ${HALO}>${t}</text>`;
    });
  });
  lines.forEach(([v, label, color], i) => {
    s += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 4}" y2="${H - 22}" stroke="${color}" stroke-width="1.8" stroke-dasharray="5 4"/>` +
      `<text x="${top0[i].x}" y="${10 + topRow[i] * 16}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${color}" ${HALO}>${label} ${App.num(v)}</text>`;
  });
  el.innerHTML = s + "</svg>";
};

/* ---------- Bar chart for one history series (handles negatives and n/m) ----------
   Room is kept below the axis for negative values' labels, long period names wrap onto two
   lines, and value labels that would touch are thinned out (the latest is always kept). */
Charts.bars = function (el, periods, series) {
  const vals = series.values.filter(App.isNum);
  const n = periods.length;
  const W = Math.max(300, Math.min(widthOf(el, 300), 520)), L = 6, R = W - 6, slot = (R - L) / n;
  // Period names: shorten "FY2022" to "FY22" and use a smaller size if they'd touch; split
  // two-word names ("Last 12 months") over two lines.
  const fits = (t, size) => App.textW(t, size) <= slot - 8;
  const one = periods.map(String).filter((t) => !t.includes(" "));
  const pfs = [12, 11, 10].find((z) => one.every((t) => fits(t, z))) || 10;
  const shorten = !one.every((t) => fits(t, pfs));
  const wrap = (p) => { let t = String(p); if (shorten) t = t.replace(/^FY\s?20(\d\d)/, "FY$1");
    if (fits(t, pfs) || !t.includes(" ")) return [t];
    const mid = t.lastIndexOf(" ", Math.ceil(t.length / 2) + 2); return [t.slice(0, mid), t.slice(mid + 1)]; };
  const plab = periods.map(wrap), xRows = Math.max(...plab.map((l) => l.length));
  const neg = vals.some((v) => v < 0);
  const H = 210 + (xRows - 1) * 14, top = 26, axisBottom = H - 14 - xRows * 14, bottom = axisBottom - (neg ? 20 : 0);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals) * 1.15 || 1;
  const y = scale(lo, hi, bottom, top);
  const bw = Math.min(56, slot * 0.6);
  const ink = css("--ink"), soft = css("--ink-soft");
  // Value labels sit on their bars (below a negative bar). If they'd touch, try a smaller size,
  // then without the "Rs " in front (the heading says what the figures are); any label that
  // still can't fit is left off, latest bar first so it always keeps its label.
  const order = [n - 1, ...periods.map((_, i) => i).slice(0, -1)];
  let fs = 13, txt, show;
  for (const [size, short] of [[13, false], [12, false], [11, false], [11, true], [10, true]]) {
    fs = size;
    txt = (v) => { const t = App.withUnit(v, series.unit); return short ? t.replace(/^Rs\s/, "") : t; };
    const box = (i) => { const v = series.values[i]; if (!App.isNum(v)) return []; const w = App.textW(txt(v), fs), cx = L + slot * i + slot / 2;
      return [{ x: cx - w / 2, y: v < 0 ? y(v) + 3 : y(Math.max(0, v)) - fs - 5, w, h: fs + 2 }]; };
    const picked = App.placeBoxes(order.map(box), { W: W + 40 });
    show = new Set(order.filter((i, k) => picked[k] === 0));
    if (order.every((i) => show.has(i) || !App.isNum(series.values[i]))) break;
  }
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${App.esc(series.label)} by period">`;
  s += `<line x1="${L}" x2="${R}" y1="${y(0)}" y2="${y(0)}" stroke="${css("--rule")}" stroke-width="1.5"/>`;
  periods.forEach((p, i) => {
    const cx = L + slot * i + slot / 2;
    const v = series.values[i];
    const note = series.notes && series.notes[i];
    const last = i === n - 1;
    if (App.isNum(v)) {
      const y0 = y(Math.max(0, v)), h = Math.abs(y(v) - y(0));
      const color = v < 0 ? css("--bad") : last ? css("--accent") : soft;
      s += `<rect x="${cx - bw / 2}" y="${y0}" width="${bw}" height="${Math.max(h, 1)}" rx="3" fill="${color}" opacity="${last ? 1 : 0.55}"><title>${App.esc(p)}: ${App.withUnit(v, series.unit)}${note ? " (" + App.esc(note) + ")" : ""}</title></rect>`;
      if (show.has(i)) s += `<text x="${cx}" y="${v < 0 ? y(v) + 15 : y0 - 6}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${ink}" ${HALO}>${txt(v)}</text>`;
    } else {
      s += `<text x="${cx}" y="${y(0) - 8}" text-anchor="middle" font-size="12" fill="${soft}">n/m</text>`;
      if (note && App.textW(note, 11) <= slot) s += `<text x="${cx}" y="${y(0) - 23}" text-anchor="middle" font-size="11" fill="${soft}">${App.esc(note)}</text>`;
    }
    plab[i].forEach((line, k) => { s += `<text x="${cx}" y="${axisBottom + 18 + k * 14}" text-anchor="middle" font-size="${pfs}" fill="${soft}">${App.esc(line)}</text>`; });
  });
  el.innerHTML = s + "</svg>";
};

/* ---------- Fair value, buy price and share price across updates ----------
   Dates that would overlap are thinned out (first and latest always shown). */
Charts.timeline = function (el, entries) {
  // Several updates on one day (a redo and a correction, say) would stack as a vertical jump:
  // keep only the last update of each day.
  const byDay = new Map();
  entries.filter((e) => App.parseDate(e.date)).forEach((e) => byDay.set(String(e.date).slice(0, 10), e));
  const pts = [...byDay.values()];
  const series = [
    ["priceAtTime", "Price", "--accent"],
    ["fairValue", "Fair", "--ink"],
    ["buyPrice", "Buy", "--good"],
  ];
  const vals = pts.flatMap((e) => series.map(([k]) => e[k])).filter(App.isNum);
  if (pts.length < 2 || !vals.length) { el.innerHTML = ""; return; }
  const first = pts[0], last = pts[pts.length - 1];
  // tiles: where each line ended, and how it moved since the first update
  const tile = ([k, label, c]) => { if (!App.isNum(last[k])) return "";
    const f = pts.find((e) => App.isNum(e[k])), ch = f && f !== last && f[k] ? (last[k] / f[k] - 1) * 100 : null;
    return `<div class="tl-t" style="--c:var(${c})"><span>${label === "Price" ? "Price" : label === "Fair" ? "Fair value" : "Buy price"}</span><b>${App.num(last[k], 2)}</b>${
      App.isNum(ch) ? `<em class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${App.num(Math.abs(ch), 1)}%<span> since ${App.date(f.date).replace(/ \d{4}$/, "")}</span></em>` : ""}</div>`; };
  const gap = App.isNum(last.priceAtTime) && App.isNum(last.fairValue) && last.fairValue ? (last.priceAtTime / last.fairValue - 1) * 100 : null;
  // updates evenly spaced, so close dates don't bunch up on a phone
  const W = widthOf(el), H = 230, L = 34, R = W - 74, top = 22, bottom = H - 34, fs = 11.5;
  const n = pts.length, x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (R - L));
  const lo = Math.min(...vals) * 0.85, hi = Math.max(...vals) * 1.08;
  const y = scale(lo, hi, bottom, top);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fair value, buy price and share price at each update">
    <defs><linearGradient id="tl-over" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${css("--bad")}" stop-opacity="0.28"/><stop offset="1" stop-color="${css("--bad")}" stop-opacity="0.06"/></linearGradient>
    <linearGradient id="tl-under" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${css("--good")}" stop-opacity="0.06"/><stop offset="1" stop-color="${css("--good")}" stop-opacity="0.28"/></linearGradient></defs>`;
  niceTicks(lo, hi, 4).forEach((t) => {
    s += `<line x1="${L}" x2="${R}" y1="${y(t)}" y2="${y(t)}" stroke="${css("--rule")}" stroke-dasharray="2 4"/>` +
      `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="${fs}" fill="${css("--ink-soft")}">${App.num(t)}</text>`;
  });
  // the gap between share price and fair value, red where the price was above it, green where below
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b2 = pts[i + 1];
    if (![a.priceAtTime, a.fairValue, b2.priceAtTime, b2.fairValue].every(App.isNum)) continue;
    const over = a.priceAtTime + b2.priceAtTime >= a.fairValue + b2.fairValue;
    s += `<polygon class="tl-gap" fill="url(#tl-${over ? "over" : "under"})" points="${x(i)},${y(a.priceAtTime)} ${x(i + 1)},${y(b2.priceAtTime)} ${x(i + 1)},${y(b2.fairValue)} ${x(i)},${y(a.fairValue)}"/>`;
  }
  // a faint column and date for every update
  const items = pts.map((e, i) => ({ x: x(i), w: App.textW(App.date(e.date).replace(/ \d{4}$/, ""), fs), anchor: i === 0 ? "start" : i === n - 1 ? "end" : "middle", prio: i === n - 1 ? 3 : i === 0 ? 2 : 1 }));
  const show = App.fitLabels(items, 6);
  pts.forEach((e, i) => {
    s += `<line x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${bottom}" stroke="${css("--rule")}" opacity="0.6"/>`;
    if (show.has(i)) s += `<text x="${x(i)}" y="${H - 12}" text-anchor="${items[i].anchor}" font-size="${fs}" fill="${css("--ink-soft")}">${App.date(e.date).replace(/ \d{4}$/, "")}</text>`;
  });
  const ends = [];
  series.forEach(([k, label, c]) => {
    const idx = pts.map((e, i) => i).filter((i) => App.isNum(pts[i][k]));
    if (!idx.length) return;
    s += `<polyline pathLength="1" class="tl-line" fill="none" stroke="${css(c)}" stroke-width="${k === "fairValue" ? 3 : 2.5}" stroke-linejoin="round" stroke-linecap="round" points="${idx.map((i) => `${x(i)},${y(pts[i][k])}`).join(" ")}"/>`;
    idx.forEach((i) => { const end = i === n - 1;
      s += `${end ? `<circle class="tl-pulse" cx="${x(i)}" cy="${y(pts[i][k])}" r="5" fill="${css(c)}"/>` : ""}<circle cx="${x(i)}" cy="${y(pts[i][k])}" r="${end ? 5 : 3.5}" fill="${end ? css(c) : css("--surface")}" stroke="${css(c)}" stroke-width="2"><title>${label} ${App.rs(pts[i][k])}, ${App.date(pts[i].date)}</title></circle>`; });
    const li = idx[idx.length - 1]; ends.push({ y: y(pts[li][k]), v: pts[li][k], c: css(c), label });
  });
  // name and latest value of each line at the right edge, nudged apart if they're close
  ends.sort((a, b) => a.y - b.y).forEach((e, i, arr) => { if (i && e.y - arr[i - 1].y < 16) e.y = arr[i - 1].y + 16; });
  ends.forEach((e) => { s += `<text x="${R + 9}" y="${(e.y + 4).toFixed(1)}" font-size="12" fill="${e.c}" ${HALO}><tspan font-weight="400" opacity="0.8">${e.label} </tspan><tspan font-weight="700">${App.num(e.v, e.v >= 100 ? 0 : 2)}</tspan></text>`; });
  // the gap at the latest update, as a pill between the two lines
  if (App.isNum(gap)) {
    const gy = (y(last.priceAtTime) + y(last.fairValue)) / 2, txt = `${gap >= 0 ? "+" : "−"}${App.num(Math.abs(gap), 0)}%`, pw = App.textW(txt, 11) + 12;
    s += `<g class="tl-pill"><rect x="${x(n - 1) - pw - 10}" y="${gy - 10}" width="${pw}" height="20" rx="10" fill="${css(gap >= 0 ? "--bad" : "--good")}"/><text x="${x(n - 1) - 10 - pw / 2}" y="${gy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" style="fill:#fff">${txt}</text></g>`;
  }
  const verdict = App.isNum(gap) ? `<div class="tl-verdict ${gap >= 0 ? "over" : "under"}"><i aria-hidden="true">${gap >= 0 ? "🔺" : "🟢"}</i> At the last update the price was <b>${App.num(Math.abs(gap), 0)}% ${gap >= 0 ? "above" : "below"}</b> fair value</div>` : "";
  el.innerHTML = `<div class="tl-tiles">${series.map(tile).join("")}</div>${verdict}${s}</svg>`;
};

/* Charts are drawn at their shown width, so redraw them when the width changes (phone turned,
   window resized, a hidden tab opened). */
Charts._drawn = new Set();
["ladder", "models", "bars", "timeline"].forEach((k) => {
  const draw = Charts[k];
  Charts[k] = function (el, ...args) { if (!el) return; el._chart = () => draw(el, ...args); el._w = el.clientWidth; Charts._drawn.add(el); return draw(el, ...args); };
});
(function () {
  let t;
  const redraw = () => Charts._drawn.forEach((el) => { if (!el.isConnected) { Charts._drawn.delete(el); return; } if (el._chart && el.clientWidth && el.clientWidth !== el._w) { el._w = el.clientWidth; el._chart(); } });
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(redraw, 150); });
  document.addEventListener("click", () => setTimeout(redraw, 60));
})();
