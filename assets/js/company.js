/* Company page: renders one analysis file section by section.
   Each section is independent: if its data is missing or broken it shows
   "Not available in this analysis" and the rest of the page still works. */
"use strict";

(async function () {
  App.init();
  const content = document.getElementById("content");
  const toc = document.getElementById("toc");
  const ticker = new URLSearchParams(location.search).get("t");
  if (!ticker) { content.innerHTML = `<p>No company chosen. <a href="./">See all companies</a>.</p>`; return; }

  let d, index, prices, alertData, research;
  try {
    [d, index, prices, alertData, research] = await Promise.all([
      App.load(`data/tickers/${encodeURIComponent(ticker)}.json`),
      App.loadOptional("data/index.json", { companies: [] }),
      App.loadOptional("data/prices.json", {}),
      App.loadOptional("data/alerts.json", { targets: [] }),
      App.loadOptional(`data/research/${encodeURIComponent(ticker)}.json`, null),
    ]);
  } catch (e) {
    content.innerHTML = `<p>There is no analysis for ${App.esc(ticker)}. <a href="./">See all companies</a>.</p>`;
    return;
  }
  const meta = (index.companies || []).find((c) => c.ticker === d.ticker) || { ticker: d.ticker, name: (d.company && d.company.name) || d.ticker };
  const bad = new Set((d._build && d._build.badSections) || []);
  const has = (k) => d[k] !== undefined && d[k] !== null && !bad.has(k);
  const NA = '<p class="na">Not available in this analysis.</p>';
  document.title = `${meta.name} (${d.ticker})`;

  const v = has("valuation") ? d.valuation : {};
  const classes = has("shareClasses") ? d.shareClasses : [{ symbol: d.ticker, label: "Voting" }];
  const mainPrice = App.resolvePrice(classes[0].symbol, has("price") ? d.price : null, prices);
  const classSymbols = new Set(classes.map((c) => c.symbol));
  const myTargets = (alertData.targets || []).filter((t) => classSymbols.has(t.symbol));
  const status = App.priceStatus(mainPrice, v);

  /* ---------- Sections ---------- */
  const sections = [
    { id: "overview", title: "Overview", always: true, html: () => {
      const rows = classes.map((sc, i) => {
        const pr = i === 0 ? mainPrice : App.resolvePrice(sc.symbol, null, prices);
        const chg = pr && pr.source === "cse" && App.isNum(pr.changePct) && pr.changePct !== 0
          ? `<span class="chg ${pr.changePct > 0 ? "up" : "down"}">${App.signedPct(pr.changePct)}</span>` : "";
        return `<div class="price-line"><span class="sym">${App.esc(sc.symbol)} ${App.esc(sc.label || "")}</span><span><span class="val">${pr ? App.price(pr.value) : "–"}</span>${chg}</span></div>
          <div class="src">${App.esc(App.priceSourceText(pr))}</div>`;
      }).join("");
      const statuses = [];
      if (status) statuses.push(`<div class="status ${status.cls}"><b>${App.esc(status.label)}</b>${status.key !== "above-fair" ? ` (${App.esc(status.rel)})` : ""}, using fair value ${App.rs(v.fairValue)}.</div>`);
      const rs = has("resultsCovered") ? App.resultsStatus(d.resultsCovered, has("company") ? d.company.fiscalYearEnd : null) : null;
      if (has("resultsCovered")) statuses.push(`<div class="status ${rs ? rs.level : ""}">Based on ${App.esc(d.resultsCovered.label || App.date(d.resultsCovered.periodEnd))}${d.resultsCovered.audited === false ? ", unaudited" : ""}. ${rs ? App.esc(rs.text) : ""}</div>`);
      if (has("price") && d.price.note) statuses.push(`<div class="status">${App.esc(d.price.note)}</div>`);

      const cat = has("quality") ? App.category(d.quality, v, classes.map((sc, i) => (i === 0 ? mainPrice : App.resolvePrice(sc.symbol, null, prices)))) : null;
      if (cat) statuses.unshift(`<div class="status ${cat.n === 3 ? "bad" : cat.n === 1 ? "good" : "warn"}"><b>Category ${cat.n}: ${cat.name}.</b> ${App.esc(d.quality.reason || "")} <a href="#quality">See the tests</a></div>`);

      const sum = has("summary") ? d.summary : null;
      return `
        <div class="hero-head">${App.logo(meta)}<div><h1>${App.esc(meta.name)}</h1>
          <div class="hero-meta">${App.esc(d.ticker)}${meta.sector ? ", " + App.esc(meta.sector) : ""}. Analysis of ${App.date(d.analysisDate)}.</div></div></div>
        <div class="hero-grid">
          <div>${sum ? `<p class="verdict">${App.esc(sum.headline || "")}</p>${App.md(sum.text)}` : NA}</div>
          <div class="hero-prices">${rows}<div class="status-list">${statuses.join("")}</div></div>
        </div>
        <div class="ladder"><div id="ladder"></div>
          <p class="ladder-caption">${App.term("Strong-buy price", "Strong-buy price")} ${App.rs(v.strongBuyPrice)} and ${App.term("buy price", "Buy price")} ${App.rs(v.buyPrice)} come from ${App.term("fair value", "Fair value")} ${App.rs(v.fairValue)} minus a ${App.term("margin of safety", "Margin of safety")}${v.marginOfSafety ? ` of ${v.marginOfSafety.strongBuy}% and ${v.marginOfSafety.buy}%` : ""}.</p></div>`;
    }, after: () => {
      const ex = has("scenarios") && d.scenarios.averages ? [d.scenarios.averages.bull] : [];
      Charts.ladder(document.getElementById("ladder"), { price: mainPrice && mainPrice.value, strongBuy: v.strongBuyPrice, buy: v.buyPrice, fair: v.fairValue, extra: ex,
        targets: myTargets.filter((t) => t.symbol === classes[0].symbol) });
    } },

    { id: "quality", title: "Business tests", key: "quality", html: () => {
      const q = d.quality, n = q.tests.filter((t) => t.pass).length;
      return `<h2>Business tests</h2>
      <p class="section-lead">Is this a business worth owning for years? It passes ${n} of ${q.tests.length} tests; it needs 3 to count as a good business. A good business goes on the watch list, and becomes "Buy now" when a share class is at or below the buy price.</p>
      <div class="tests">${q.tests.map((t) => `<div class="test ${t.pass ? "pass" : "fail"}">
        <div class="test-mark" aria-hidden="true">${t.pass ? "✓" : "✗"}</div>
        <div><div class="test-label">${App.esc(t.label)} <span class="sr-only">${t.pass ? "(passed)" : "(failed)"}</span></div>
          <div class="test-value">${App.esc(t.value || "")}</div>${t.note ? `<div class="test-note">${App.esc(t.note)}</div>` : ""}</div></div>`).join("")}</div>
      ${q.assessed ? `<p class="section-lead">Assessed ${App.date(q.assessed)}.</p>` : ""}`;
    } },

    { id: "figures", title: "Key figures", key: "keyMetrics", html: () => `<h2>Key figures</h2>
      <div class="figures">${d.keyMetrics.map((m) => `<div class="figure"><div class="lbl">${App.term(m.label)}</div>
        <div class="num">${App.esc(m.display || App.withUnit(m.value, m.unit))}</div>${m.note ? `<div class="note">${App.esc(m.note)}</div>` : ""}</div>`).join("")}</div>` },

    { id: "results", title: "Latest results", key: "highlights", html: () => `<h2>Latest results</h2>
      <div class="highlights">${d.highlights.map((h) => `<div><h3>${App.esc(h.title || "")}</h3>${App.md(h.text)}</div>`).join("")}</div>` },

    { id: "changes", title: "What changed", always: true, html: () => {
      if (!research) return `<h2>What changed</h2><p class="section-lead">No research record yet for this company.</p>`;
      const log = (research.changeLog || []).slice().reverse();
      const entries = log.map((e, i) => {
        const prev = log[i + 1];
        const fv = prev && App.isNum(prev.fairValue) && App.isNum(e.fairValue) && prev.fairValue !== e.fairValue
          ? `Fair value ${App.rs(prev.fairValue)} → <b>${App.rs(e.fairValue)}</b>` : App.isNum(e.fairValue) ? `Fair value <b>${App.rs(e.fairValue)}</b>` : "";
        return `<div class="status"><b>${App.date(e.date)}</b>${e.basedOn ? `, based on ${App.esc(e.basedOn)}` : ""}. ${fv}${App.isNum(e.buyPrice) ? `, buy price ${App.rs(e.buyPrice)}` : ""}.
          <div>${App.esc(e.summary || "")}</div></div>`;
      }).join("");
      const periods = (research.periods || []).slice().sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
      const allNames = [...new Set(periods.flatMap((p) => Object.keys(p.figures || {})))];
      const LABELS = { revenue: "Revenue", grossProfit: "Gross profit", grossMarginPct: "Gross margin", netProfit: "Net profit", eps: "EPS",
        dividendPerShare: "Dividend per share", navPerShare: "NAV per share", roe: "Return on equity", peYearEnd: "P/E at year-end",
        operatingCashFlow: "Operating cash flow", capexPaid: "Capex paid", capexCommitted: "Capex committed", freeCashFlow: "Free cash flow",
        netDebt: "Net debt", netDebtToEbitda: "Net debt / EBITDA", debtToEquity: "Debt to equity", sharesOutstanding: "Shares outstanding",
        fxGainLoss: "Exchange gain (loss)", contractedCapex: "Contracted capex", priceYearEnd: "Share price at year-end" };
      const order = Object.keys(LABELS);
      const names = allNames.slice().sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
      const cell = (f) => {
        if (!f) return `<td class="num"></td>`;
        const txt = App.isNum(f.value) ? App.withUnit(f.value, f.unit) : "–";
        const tip = [f.note, f.source].filter(Boolean).join(". ");
        return `<td class="num" title="${App.esc(tip)}">${txt}${f.note ? " *" : ""}</td>`;
      };
      const figTable = names.length ? `<div class="table-wrap"><table><thead><tr><th></th>${periods.map((p) => `<th class="num">${App.esc(p.period)}${p.audited === false ? "<br><span style='font-weight:400'>unaudited</span>" : ""}</th>`).join("")}</tr></thead>
        <tbody>${names.map((n) => `<tr><td>${App.term(LABELS[n] || n)}</td>${periods.map((p) => cell((p.figures || {})[n])).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="section-lead" style="margin-top:.5rem">Hover over a figure to see its source. * means there's a note.</p>` : `<p class="na">No figures saved yet.</p>`;
      const inputs = (research.valuationInputs || []).map((v) => `<tr><td>${App.term(v.name)}</td><td>${App.esc(v.value)}</td><td>${App.esc(v.reason || "")}</td><td style="white-space:nowrap">${App.date(v.since)}</td></tr>`).join("");
      const reports = (research.reportsRead || []).map((r) => `<li>${App.esc(r.title || r.file)}${r.audited === false ? " (unaudited)" : ""}, read ${App.date(r.readOn)}</li>`).join("");
      return `<h2>What changed</h2>
        <p class="section-lead">Each update builds on the saved research record, reading only new reports.</p>
        <div class="status-list" style="margin-bottom:1rem">${entries || '<p class="na">No updates logged yet.</p>'}</div>
        ${log.length >= 2 ? `<div class="chart"><h3>Fair value over time</h3><div id="timeline"></div>
          <div class="legend"><span><i style="background:var(--ink)"></i>Fair value</span><span><i style="background:var(--good)"></i>Buy price</span><span><i style="background:var(--accent)"></i>Share price at the time</span></div></div>`
          : `<p class="section-lead">A fair-value history chart appears after the next update.</p>`}
        ${(research.openQuestions || []).length ? `<h3 style="margin:1.2rem 0 .4rem">To check in the next report</h3><ul>${research.openQuestions.map((q) => `<li>${App.esc(q)}</li>`).join("")}</ul>` : ""}
        <details class="more"><summary>Saved figures by period</summary>${figTable}</details>
        ${inputs ? `<details class="more"><summary>Valuation inputs and reasons</summary><div class="table-wrap"><table><thead><tr><th>Input</th><th>Value</th><th>Reason</th><th>Since</th></tr></thead><tbody>${inputs}</tbody></table></div></details>` : ""}
        ${reports ? `<details class="more"><summary>Reports read</summary><ul>${reports}</ul></details>` : ""}`;
    }, after: () => { const el = document.getElementById("timeline"); if (el) Charts.timeline(el, research.changeLog || []); } },
    { id: "methods", title: "Valuation methods", key: "models", html: () => `<h2>Valuation methods</h2>
      <p class="section-lead">Value per share under each method, from the pessimistic (${App.term("bear", "Bear")}) to the optimistic (${App.term("bull", "Bull")}) case.</p>
      <div class="chart"><div id="models-chart"></div>
        <div class="legend"><span><i style="background:var(--bad)"></i>Bear</span><span><i style="background:var(--ink)"></i>Base</span><span><i style="background:var(--good)"></i>Bull</span>
        <span><i style="background:var(--accent);border-radius:2px;transform:rotate(45deg)"></i>${App.term("Weighted", "Weighted")}</span></div></div>
      ${d.models.some((m) => m.comment) || (has("modelsNote")) ? `<div style="margin-top:1rem">${has("modelsNote") ? App.md(d.modelsNote) : ""}
        ${d.models.filter((m) => m.comment).map((m) => `<p><b>${App.esc(m.name)}:</b> ${App.esc(m.comment)}</p>`).join("")}</div>` : ""}
      <div class="table-wrap" style="margin-top:1rem"><table><thead><tr><th>Method</th><th class="num">Bear</th><th class="num">Base</th><th class="num">Bull</th><th class="num">Weighted</th></tr></thead>
        <tbody>${d.models.map((m) => `<tr><td>${App.term(m.name)}</td><td class="num">${App.rs(m.bear)}</td><td class="num">${App.rs(m.base)}</td><td class="num">${App.rs(m.bull)}</td><td class="num">${App.rs(m.weighted)}</td></tr>`).join("")}</tbody></table></div>
      ${has("methodReadings") ? `<details class="more"><summary>What each measure says</summary><div class="table-wrap"><table><thead><tr><th>Measure</th><th>Value</th><th>Reading</th></tr></thead>
        <tbody>${d.methodReadings.map((r) => `<tr><td>${App.term(r.method)}</td><td style="white-space:nowrap">${App.esc(r.value || "")}</td><td>${App.esc(r.reading)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}`,
      after: () => Charts.models(document.getElementById("models-chart"), d.models, { price: mainPrice && mainPrice.value, fair: v.fairValue }) },

    { id: "history", title: "History", key: "history", html: () => `<h2>History</h2>
      <p class="section-lead">n/m means not meaningful, for example P/E in a loss year.</p>
      <div class="two-col">${d.history.series.map((s, i) => `<div class="chart"><h3>${App.term(s.label)}</h3><div id="hist-${i}"></div></div>`).join("")}</div>`,
      after: () => d.history.series.forEach((s, i) => Charts.bars(document.getElementById(`hist-${i}`), d.history.periods, s)) },

    { id: "scenarios", title: "Assumptions", key: "scenarios", html: () => {
      const s = d.scenarios, w = v.scenarioWeights || {};
      const head = ["bear", "base", "bull"].map((k) => `<th>${App.term(k[0].toUpperCase() + k.slice(1), k[0].toUpperCase() + k.slice(1))}${App.isNum(w[k]) ? ` (${w[k]}% weight)` : ""}</th>`).join("");
      return `<h2>Assumptions</h2>
        <div class="table-wrap"><table><thead><tr><th></th>${head}</tr></thead><tbody>
          ${(s.assumptions || []).map((a) => `<tr><td>${App.term(a.label)}</td><td>${App.esc(a.bear ?? "")}</td><td>${App.esc(a.base ?? "")}</td><td>${App.esc(a.bull ?? "")}</td></tr>`).join("")}
          ${s.averages ? `<tr class="total"><td>Average of the methods</td><td>${App.rs(s.averages.bear)}</td><td>${App.rs(s.averages.base)}</td><td>${App.rs(s.averages.bull)}</td></tr>` : ""}
        </tbody></table></div>
        ${s.common ? `<div style="margin-top:1rem"><h3 style="margin-bottom:.3rem">Shared by all cases</h3>${App.md(s.common)}</div>` : ""}
        ${v.note ? `<p class="section-lead" style="margin-top:.6rem">${App.esc(v.note)}</p>` : ""}`;
    } },

    { id: "sensitivity", title: "Sensitivity", key: "sensitivity", html: () => {
      const s = d.sensitivity, price = mainPrice && mainPrice.value;
      const cell = (val, r, c) => {
        let style = "";
        if (App.isNum(val) && App.isNum(price)) {
          const diff = (val - price) / price;
          const pct = Math.min(60, Math.round(Math.abs(diff) * 160)) + 10;
          style = `background:color-mix(in srgb, var(${diff >= 0 ? "--good" : "--bad"}) ${pct}%, var(--surface))`;
        }
        const isBase = s.base && s.base.row === r && s.base.column === c;
        return `<td class="${isBase ? "base" : ""}" style="${style}" title="${isBase ? "Base case" : ""}">${App.isNum(val) ? App.num(val) : "–"}</td>`;
      };
      return `<h2>${App.term("Sensitivity", "Sensitivity")}</h2>
        <p class="section-lead">${App.esc(s.title || "")}. Green cells are above today's price${App.isNum(price) ? ` (${App.price(price)})` : ""}, red cells below. The outlined cell is the base case.</p>
        <div class="table-wrap" style="max-width:640px"><table class="heat"><thead>
          <tr><th class="rowh">${App.term(s.rowLabel || "")} ↓ / ${App.esc(s.columnLabel || "")} →</th>${s.columns.map((c) => `<th>${App.esc(c)}</th>`).join("")}</tr></thead>
          <tbody>${s.rows.map((r, i) => `<tr><th class="rowh">${App.esc(r)}</th>${s.values[i].map((val, j) => cell(val, i, j)).join("")}</tr>`).join("")}</tbody></table></div>
        ${s.note ? `<p style="margin-top:1rem">${App.esc(s.note)}</p>` : ""}`;
    } },

    { id: "alerts", title: "Your alerts", always: true, html: () => {
      if (!myTargets.length) return `<h2>Your alerts</h2><p class="section-lead">No price alerts set for this company. Add targets to <b>alerts.json</b> in the repository to get Telegram messages.</p>`;
      const rows = myTargets.map((t) => {
        const pr = App.resolvePrice(t.symbol, t.symbol === classes[0].symbol && has("price") ? d.price : null, prices);
        let state;
        if (t.fired) state = `Sent on ${App.date(t.fired.at.slice(0, 10))} at ${App.price(t.fired.price)}`;
        else if (pr) {
          const away = ((t.price - pr.value) / pr.value) * 100;
          state = `Waiting: ${Math.abs(away).toFixed(1)}% ${away < 0 ? "below" : "above"} the latest price`;
        } else state = "Waiting";
        return `<tr><td>${App.esc(t.symbol)}</td><td>${t.direction === "below" ? "At or below" : "At or above"} <b>${App.rs(t.price)}</b></td>
          <td>${App.esc(t.note || "")}</td><td>${App.esc(state)}</td></tr>`;
      }).join("");
      return `<h2>Your alerts</h2>
        <p class="section-lead">Checked about every 30 minutes during trading and after the close. Each alert is sent to Telegram once; change the target in alerts.json to set it again.</p>
        <div class="table-wrap"><table><thead><tr><th>Share</th><th>Target</th><th>Note</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } },

    { id: "buy-plan", title: "Buy plan", key: "buyPlan", html: () => {
      const b = d.buyPlan, price = mainPrice && mainPrice.value;
      const tiers = b.tiers.map((t) => {
        const hit = App.isNum(price) && price <= t.maxPrice;
        const gap = App.isNum(price) ? ((price - t.maxPrice) / price) * 100 : null;
        return `<div class="tier ${hit ? "hit" : ""}"><span class="shares">${App.num(t.shares)} shares</span><span>at up to <b>${App.rs(t.maxPrice)}</b></span>
          <span class="state">${hit ? "Price is in range now" : gap !== null ? `Needs a ${gap.toFixed(0)}% fall` : ""}</span></div>`;
      }).join("");
      return `<h2>Buy plan</h2>
        <div class="plan-sum">
          ${App.isNum(b.totalShares) ? `<div><span>Total</span><b>${App.num(b.totalShares)} shares</b></div>` : ""}
          ${App.isNum(b.averagePrice) ? `<div><span>Average price</span><b>${App.price(b.averagePrice)}</b></div>` : ""}
          ${App.isNum(b.totalCost) ? `<div><span>Total cost</span><b>Rs ${App.num(b.totalCost, 0)}</b></div>` : ""}
          ${App.isNum(price) && App.isNum(b.totalShares) ? `<div><span>Cost at today's price</span><b>Rs ${App.num(Math.round(price * b.totalShares), 0)}</b></div>` : ""}
        </div>
        <div class="tiers">${tiers}</div>
        ${b.note ? `<p style="margin-top:1rem">${App.esc(b.note)}</p>` : ""}
        ${b.realism ? `<h3 style="margin:1rem 0 .3rem">How realistic is it?</h3>${App.md(b.realism)}` : ""}`;
    } },

    { id: "change", title: "What would change the view", key: "changeMyView", html: () => `<h2>What would change the view</h2>
      <div class="cmv"><div class="higher"><h3>Supports a higher value</h3><ul>${(d.changeMyView.higher || []).map((x) => `<li>${App.esc(x)}</li>`).join("")}</ul></div>
      <div class="lower"><h3>Supports a lower value</h3><ul>${(d.changeMyView.lower || []).map((x) => `<li>${App.esc(x)}</li>`).join("")}</ul></div></div>` },

    { id: "full", title: "Full analysis", key: "fullText", html: () => `<h2>Full analysis</h2>
      ${has("notes") && d.notes.disclaimer ? `<p class="disclaimer">${App.esc(d.notes.disclaimer)}</p>` : ""}
      ${has("resultsCovered") && Array.isArray(d.resultsCovered.sources) ? `<p class="disclaimer">Sources: ${d.resultsCovered.sources.map(App.esc).join("; ")}.</p>` : ""}
      <details class="more"><summary>Show the complete original text</summary><div class="fulltext">${App.esc(d.fullText)}</div></details>` },
  ];

  /* Sections the site doesn't know yet are listed at the end. */
  const knownKeys = new Set(["schemaVersion", "ticker", "analysisDate", "company", "shareClasses", "resultsCovered", "price", "summary", "valuation",
    "keyMetrics", "highlights", "history", "methodReadings", "models", "modelsNote", "scenarios", "sensitivity", "buyPlan", "changeMyView", "notes", "fullText", "_build"]);
  const unknown = Object.keys(d).filter((k) => !knownKeys.has(k));
  const pretty = (val) => Array.isArray(val) ? `<ul>${val.map((x) => `<li>${pretty(x)}</li>`).join("")}</ul>`
    : val && typeof val === "object" ? `<dl class="other">${Object.entries(val).map(([k, x]) => `<dt>${App.esc(k)}</dt><dd>${pretty(x)}</dd>`).join("")}</dl>`
    : App.esc(val);
  if (unknown.length) sections.push({ id: "other", title: "Other details", always: true, html: () => `<h2>Other details</h2>
    <dl class="other">${unknown.map((k) => `<dt>${App.esc(k)}</dt><dd>${pretty(d[k])}</dd>`).join("")}</dl>` });

  /* ---------- Render ---------- */
  function render() {
    let banner = "";
    if (d._build && d._build.previousVersion) banner = `<div class="banner">The latest file for this company was rejected by the data check, so this is the previous valid version.</div>`;
    const lr = meta.latestResearch;
    if (App.isRecentResearch(lr) && !App.isDismissed(App.researchKey(d.ticker, lr))) {
      banner += `<div class="notice" role="status" id="research-notice"><div><h2>${lr.kind === "updated" ? "This analysis was updated" : "New research published"}</h2>
        <p style="margin:0">${App.researchLine(lr)}${lr.kind === "updated" && lr.summary ? ` ${App.esc(lr.summary)}` : ""} <a href="#changes">See what changed</a></p></div>
        <button type="button" data-dismiss="${App.esc(App.researchKey(d.ticker, lr))}">Dismiss</button></div>`;
    }
    content.innerHTML = banner + sections.map((s) => {
      let inner;
      try { inner = s.always || has(s.key) ? s.html() : `<h2>${App.esc(s.title)}</h2>${NA}`; }
      catch (e) { console.error(s.id, e); inner = `<h2>${App.esc(s.title)}</h2>${NA}`; }
      return `<section class="section" id="${s.id}">${inner}</section>`;
    }).join("");
    sections.forEach((s) => {
      if (!s.after || !(s.always || has(s.key))) return;
      try { s.after(); } catch (e) { console.error(s.id, e); }
    });
  }
  toc.innerHTML = sections.map((s) => `<a href="#${s.id}">${App.esc(s.title)}</a>`).join("");
  const links = [...toc.querySelectorAll("a")];
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id)); });
  }, { rootMargin: "-20% 0px -70% 0px" });
  const show = () => {
    obs.disconnect();
    render();
    document.querySelectorAll(".section").forEach((el) => obs.observe(el));
  };
  show();
  document.addEventListener("themechange", show);
  content.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dismiss]");
    if (!b) return;
    App.dismiss(b.dataset.dismiss);
    document.getElementById("research-notice")?.remove();
  });
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
