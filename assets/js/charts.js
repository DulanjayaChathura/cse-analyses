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

/* ---------- Price ladder: zones from strong-buy to above fair value ---------- */
Charts.ladder = function (el, { price, strongBuy, buy, fair, extra = [] }) {
  const vals = [price, strongBuy, buy, fair, ...extra].filter(App.isNum);
  if (!App.isNum(fair) || vals.length < 2) { el.innerHTML = '<p class="na">Not enough valuation levels to draw the price ladder.</p>'; return; }
  const lo = Math.min(...vals) * 0.8, hi = Math.max(...vals) * 1.1;
  const W = 1000, H = 150, L = 10, R = 990, barY = 62, barH = 26;
  const x = scale(lo, hi, L, R);
  const zones = [
    [lo, App.isNum(strongBuy) ? strongBuy : lo, "--zone-strong"],
    [App.isNum(strongBuy) ? strongBuy : lo, App.isNum(buy) ? buy : lo, "--zone-buy"],
    [App.isNum(buy) ? buy : lo, fair, "--zone-fair"],
    [fair, hi, "--zone-over"],
  ];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price ${App.price(price)} compared with strong-buy ${App.rs(strongBuy)}, buy ${App.rs(buy)} and fair value ${App.rs(fair)}">`;
  zones.forEach(([a, b, c], i) => {
    if (b <= a) return;
    const r = i === 0 ? 6 : 0;
    s += `<rect x="${x(a)}" y="${barY}" width="${x(b) - x(a)}" height="${barH}" fill="${css(c)}" rx="${r}"/>`;
  });
  const zoneLabels = [["Strong buy", lo, strongBuy], ["Buy", strongBuy, buy], ["Fair", buy, fair], ["Above fair value", fair, hi]];
  zoneLabels.forEach(([t, a, b]) => {
    if (!App.isNum(a) || !App.isNum(b) || x(b) - x(a) < 60) return;
    s += `<text x="${(x(a) + x(b)) / 2}" y="${barY + 17}" text-anchor="middle" font-size="13" fill="${css("--ink-soft")}">${t}</text>`;
  });
  const level = (v, label) => {
    if (!App.isNum(v)) return "";
    return `<line x1="${x(v)}" x2="${x(v)}" y1="${barY}" y2="${barY + barH + 8}" stroke="${css("--ink")}" stroke-width="1.5"/>` +
      `<text x="${x(v)}" y="${barY + barH + 26}" text-anchor="middle" font-size="14" fill="${css("--ink")}">${label}</text>` +
      `<text x="${x(v)}" y="${barY + barH + 44}" text-anchor="middle" font-size="14" font-weight="600" fill="${css("--ink")}">${App.rs(v)}</text>`;
  };
  s += level(strongBuy, "Strong buy") + level(buy, "Buy") + level(fair, "Fair value");
  if (App.isNum(price)) {
    const px = x(price);
    s += `<line x1="${px}" x2="${px}" y1="${barY - 14}" y2="${barY + barH + 2}" stroke="${css("--accent")}" stroke-width="4" stroke-linecap="round"/>` +
      `<text x="${Math.min(Math.max(px, 70), W - 70)}" y="${barY - 24}" text-anchor="middle" font-size="20" font-weight="600" fill="${css("--accent")}">Today ${App.price(price)}</text>`;
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
  return `<div class="mini-wrap" aria-hidden="true"><div class="mini">${seg(lo, sb, "--zone-strong")}${seg(sb, b, "--zone-buy")}${seg(b, fair, "--zone-fair")}${seg(fair, hi, "--zone-over")}</div>` +
    `<span class="mini-marker" style="left:${pc(price)}%"></span></div>`;
};

/* ---------- Valuation methods: bear–bull range per method ---------- */
Charts.models = function (el, models, { price, fair }) {
  const rows = models.filter((m) => App.isNum(m.bear) && App.isNum(m.bull));
  if (!rows.length) { el.innerHTML = '<p class="na">Not available in this analysis.</p>'; return; }
  const vals = rows.flatMap((m) => [m.bear, m.base, m.bull, m.weighted]).concat([price, fair]).filter(App.isNum);
  const lo = Math.max(0, Math.min(...vals) * 0.85), hi = Math.max(...vals) * 1.08;
  const W = 1000, labelW = 260, rowH = 54, top = 30, H = top + rows.length * rowH + 30;
  const x = scale(lo, hi, labelW, W - 20);
  const ink = css("--ink"), soft = css("--ink-soft"), rule = css("--rule");
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bear, base and bull value for each valuation method">`;
  niceTicks(lo, hi).forEach((t) => {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 8}" y2="${H - 26}" stroke="${rule}"/>` +
      `<text x="${x(t)}" y="${H - 8}" text-anchor="middle" font-size="13" fill="${soft}">${App.num(t)}</text>`;
  });
  rows.forEach((m, i) => {
    const y = top + i * rowH + rowH / 2;
    s += `<text x="0" y="${y + 5}" font-size="15" fill="${ink}">${App.esc(m.name)}</text>`;
    s += `<line x1="${x(m.bear)}" x2="${x(m.bull)}" y1="${y}" y2="${y}" stroke="${soft}" stroke-width="6" stroke-linecap="round" opacity="0.35"/>`;
    s += `<circle cx="${x(m.bear)}" cy="${y}" r="6" fill="${css("--bad")}"><title>Bear ${App.rs(m.bear)}</title></circle>`;
    s += `<circle cx="${x(m.bull)}" cy="${y}" r="6" fill="${css("--good")}"><title>Bull ${App.rs(m.bull)}</title></circle>`;
    if (App.isNum(m.base)) s += `<circle cx="${x(m.base)}" cy="${y}" r="8" fill="${ink}"><title>Base ${App.rs(m.base)}</title></circle>` +
      `<text x="${x(m.base)}" y="${y - 14}" text-anchor="middle" font-size="13" fill="${ink}">${App.num(m.base)}</text>`;
    if (App.isNum(m.weighted)) {
      const wx = x(m.weighted);
      s += `<path d="M${wx} ${y + 9} l7 9 l-7 9 l-7 -9 z" fill="${css("--accent")}"><title>Weighted ${App.rs(m.weighted)}</title></path>`;
    }
  });
  const vline = (v, label, color) => App.isNum(v) ?
    `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 12}" y2="${H - 26}" stroke="${color}" stroke-width="2" stroke-dasharray="5 4"/>` +
    `<text x="${x(v)}" y="${top - 16}" text-anchor="middle" font-size="13" font-weight="600" fill="${color}">${label} ${App.num(v)}</text>` : "";
  s += vline(fair, "Fair value", ink) + vline(price, "Today", css("--accent"));
  el.innerHTML = s + "</svg>";
};

/* ---------- Bar chart for one history series (handles negatives and n/m) ---------- */
Charts.bars = function (el, periods, series) {
  const vals = series.values.filter(App.isNum);
  const W = 480, H = 230, L = 10, R = W - 10, top = 28, bottom = H - 34;
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals) * 1.15 || 1;
  const y = scale(lo, hi, bottom, top);
  const n = periods.length, slot = (R - L) / n, bw = Math.min(56, slot * 0.6);
  const ink = css("--ink"), soft = css("--ink-soft");
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
      s += `<text x="${cx}" y="${v < 0 ? y(v) + 16 : y0 - 7}" text-anchor="middle" font-size="14" font-weight="600" fill="${ink}">${App.withUnit(v, series.unit)}</text>`;
    } else {
      s += `<text x="${cx}" y="${y(0) - 8}" text-anchor="middle" font-size="13" fill="${soft}">n/m</text>`;
      if (note && note.length <= 12) s += `<text x="${cx}" y="${y(0) - 24}" text-anchor="middle" font-size="11" fill="${soft}">${App.esc(note)}</text>`;
    }
    s += `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="13" fill="${soft}">${App.esc(p)}</text>`;
  });
  el.innerHTML = s + "</svg>";
};
