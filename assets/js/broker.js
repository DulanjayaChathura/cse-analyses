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
    content.innerHTML = `<div class="empty">No broker updates yet. Forward the broker's messages to the Telegram channel and they'll appear here after the evening summary.</div>`;
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

  /* One line per company on my site: price (dot), my fair value (green) and the
     broker's target (blue) on a shared scale, so the gap is visible at a glance. */
  function compareRow(call, co) {
    const fv = co.valuation && co.valuation.fairValue;
    const pts = [call.price, fv, call.target].filter(App.isNum);
    const lo = Math.min(...pts) * 0.85, hi = Math.max(...pts) * 1.08;
    const x = (v) => ((v - lo) / (hi - lo) * 100).toFixed(1);
    const g = App.isNum(fv) ? (call.price / fv - 1) * 100 : null;
    return `<div class="cmp-row">
      <div><a href="company.html?t=${encodeURIComponent(co.ticker)}" class="cmp-name">${App.esc(co.name)}</a>
        <div class="muted-s">${App.price(call.price)}${g !== null ? ` · ${pct(g)} vs my fair value` : ""}</div></div>
      <div class="cmp-bar" role="img" aria-label="Price ${call.price}, my fair value ${fv}, broker target ${call.target ?? "not set"}">
        <div class="cmp-track"></div>
        ${App.isNum(fv) ? `<div class="cmp-mk fv" style="left:${x(fv)}%" title="My fair value ${App.rs(fv)}"></div>` : ""}
        ${App.isNum(call.target) ? `<div class="cmp-mk tg" style="left:${x(call.target)}%" title="Broker target ${App.rs(call.target)}"></div>` : ""}
        <div class="cmp-dot" style="left:${x(call.price)}%" title="Price ${App.price(call.price)}"></div>
      </div>
      <div class="cmp-right">${chip(call.rating)}<div class="muted-s">${App.isNum(call.target) ? "Target " + App.rs(call.target) : "No target"} · Mine ${App.rs(fv)}</div></div>
    </div>`;
  }

  /* ---------- page ---------- */
  function render(d) {
    const m = d.market || {};
    const calls = d.calls || [];
    sub.textContent = `${d.source || "Broker"} · ${d.posts ? d.posts + " messages" : ""}${d.callsPriceDate ? ` · call prices as of ${App.date(d.callsPriceDate)}` : ""}`;

    const ownCalls = calls.filter((c) => mine[c.code]);
    const sectors = [...new Set(calls.map((c) => c.sector).filter(Boolean))].sort();
    const ratings = [...new Set(calls.map((c) => c.rating).filter(Boolean))];

    const flows = (m.foreignFlows || []).slice().sort((a, b) => a.mn - b.mn);
    const maxFlow = Math.max(1, ...flows.map((f) => Math.abs(f.mn)));

    content.innerHTML = `
      <div class="tiles">
        ${App.isNum(m.aspi) ? tile("ASPI", App.num(m.aspi, 0), pct(m.aspiChangePct, 2), m.aspiChangePct >= 0 ? "up" : "down") : ""}
        ${App.isNum(m.sp20) ? tile("S&amp;P SL20", App.num(m.sp20, 0), pct(m.sp20ChangePct, 2), m.sp20ChangePct >= 0 ? "up" : "down") : ""}
        ${App.isNum(m.turnoverBn) ? tile("Turnover", `Rs ${m.turnoverBn}bn`, App.isNum(m.marketPE) ? `Market P/E ${m.marketPE}x · P/B ${m.marketPBV}x` : "") : ""}
        ${App.isNum(m.foreignNetMn) ? tile("Foreign investors", `${m.foreignNetMn < 0 ? "−" : "+"}Rs ${Math.abs(Math.round(m.foreignNetMn))}mn`, m.foreignNetMn < 0 ? "Net sellers" : "Net buyers", m.foreignNetMn < 0 ? "down" : "up") : ""}
      </div>

      ${(d.highlights || []).length ? `<section class="bk-card"><h2>Today in short</h2><ul class="bk-list">${d.highlights.map((h) => `<li>${App.esc(h)}</li>`).join("")}</ul></section>` : ""}

      ${ownCalls.length ? `<section class="bk-card">
        <div class="bk-head"><h2>Your companies: broker vs my view</h2>
          <div class="legend"><span><i class="lg-dot"></i>Price</span><span><i class="lg-fv"></i>My fair value</span><span><i class="lg-tg"></i>Broker target</span></div></div>
        ${ownCalls.map((c) => compareRow(c, mine[c.code])).join("")}
      </section>` : ""}

      <section class="bk-card">
        <div class="bk-head"><h2>All broker calls <span class="muted-s" id="count"></span></h2>
          <div class="filters">
            <input type="search" id="q" class="search" placeholder="Search company or code" aria-label="Search calls">
            <select id="fr" aria-label="Filter by call"><option value="">All calls</option>${ratings.map((r) => `<option>${App.esc(r)}</option>`).join("")}</select>
            <select id="fs" aria-label="Filter by sector"><option value="">All sectors</option>${sectors.map((s) => `<option>${App.esc(s)}</option>`).join("")}</select>
          </div></div>
        <div class="table-wrap"><table class="bk-table">
          <thead><tr><th>Company</th><th class="col-sector">Sector</th><th class="num">Price</th><th>Call</th><th class="num">Target</th><th>Upside</th></tr></thead>
          <tbody id="rows"></tbody></table></div>
        <p class="muted-s">Sorted by the broker's upside. ★ marks companies on this site.</p>
      </section>

      <div class="bk-grid">
        ${(d.dividends || []).length ? `<section class="bk-card"><h2>Coming dividends</h2>
          <table class="bk-table"><thead><tr><th>Company</th><th class="num">Dividend</th><th class="num">Yield</th><th>XD date</th><th>Paid</th></tr></thead><tbody>
          ${d.dividends.map((v) => `<tr><td>${App.esc(v.name)} <span class="muted-s">${App.esc(v.code.split(".")[0])}</span></td><td class="num">${App.price(v.dps)}</td><td class="num">${App.isNum(v.yieldPct) ? v.yieldPct.toFixed(1) + "%" : "–"}</td><td class="nowrap">${App.date(v.xd)}</td><td class="nowrap">${App.date(v.pay)}</td></tr>`).join("")}
          </tbody></table></section>` : ""}

        ${flows.length || (m.momentum || []).length ? `<section class="bk-card"><h2>Market details</h2>
          ${flows.length ? `<h3 class="bk-sub">Foreign buying and selling (Rs mn)</h3>
          ${flows.map((f) => `<div class="flow"><span>${App.esc(f.code)}</span><div class="flow-bar"><div class="${f.mn < 0 ? "neg" : "pos"}" style="width:${(Math.abs(f.mn) / maxFlow * 50).toFixed(1)}%"></div></div><span class="num">${f.mn > 0 ? "+" : ""}${f.mn}</span></div>`).join("")}` : ""}
          ${(m.gainers || []).length ? `<p class="muted-s"><b>Lifted the index:</b> ${m.gainers.join(", ")}. <b>Held it back:</b> ${(m.losers || []).join(", ") || "–"}.</p>` : ""}
          ${(m.momentum || []).length ? `<p class="muted-s"><b>Biggest 10-day rises:</b> ${m.momentum.map((x) => `${x.code} +${x.pct}%`).join(", ")}.</p>` : ""}
        </section>` : ""}
      </div>

      ${(d.news || []).length ? `<section class="bk-card"><h2>News and views</h2>${d.news.map((n) => `<h3 class="bk-sub">${App.esc(n.title)}</h3><p>${App.esc(n.text)}</p>`).join("")}</section>` : ""}

      ${d.note ? `<p class="muted-s">${App.esc(d.note)}</p>` : ""}`;

    /* Filterable, sorted table of every call. */
    const rowsEl = document.getElementById("rows"), countEl = document.getElementById("count");
    const q = document.getElementById("q"), fr = document.getElementById("fr"), fs = document.getElementById("fs");
    const sorted = calls.slice().sort((a, b) => (upside(b) ?? -999) - (upside(a) ?? -999));
    function draw() {
      const term = q.value.trim().toLowerCase();
      const shown = sorted.filter((c) => (!fr.value || c.rating === fr.value) && (!fs.value || c.sector === fs.value)
        && (!term || (c.name + " " + c.code).toLowerCase().includes(term)));
      countEl.textContent = `(${shown.length} of ${calls.length})`;
      rowsEl.innerHTML = shown.map((c) => {
        const u = upside(c), co = mine[c.code];
        const name = co ? `<a href="company.html?t=${encodeURIComponent(co.ticker)}">★ ${App.esc(c.name)}</a>` : App.esc(c.name);
        return `<tr><td>${name} <span class="muted-s">${App.esc(c.code.split(".")[0])}${c.code.includes(".X") ? " NV" : ""}</span></td>
          <td class="muted-s col-sector">${App.esc(c.sector || "")}</td><td class="num">${App.price(c.price)}</td><td>${chip(c.rating)}</td>
          <td class="num">${App.isNum(c.target) ? App.rs(c.target) : "Not set"}</td>
          <td><div class="up-cell"><div class="up-bar"><div class="${u !== null && u < 0 ? "neg" : "pos"}" style="width:${u === null ? 0 : Math.min(100, Math.abs(u)).toFixed(0)}%"></div></div><span>${pct(u)}</span></div></td></tr>`;
      }).join("") || `<tr><td colspan="6" class="muted-s">No calls match.</td></tr>`;
    }
    [q, fr, fs].forEach((el) => el.addEventListener("input", draw));
    draw();
  }

  show(pos);
})();
