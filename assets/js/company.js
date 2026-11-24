/* Company page: renders one analysis file section by section.
   Each section is independent: if its data is missing or broken it shows
   "Not available in this analysis" and the rest of the page still works. */
"use strict";

(async function () {
  App.init();
  const content = document.getElementById("content");
  if (App.Stars.enabled()) { App.Stars.wire(content); App.Stars.load(); }
  content.addEventListener("click", (e) => { const b = e.target.closest("[data-sh-toggle]"); if (!b) return;
    const l = b.previousElementSibling, open = l.dataset.open !== "true"; l.dataset.open = open; b.textContent = open ? "Show top 10" : `Show all ${l.children.length}`; });
  content.addEventListener("click", (e) => { const b = e.target.closest("[data-mg]"); if (!b) return;
    const box = b.closest(".mg"); box.querySelectorAll("[data-mg]").forEach((x) => x.setAttribute("aria-selected", x === b));
    box.querySelectorAll("[data-mgp]").forEach((p) => p.classList.toggle("on", p.dataset.mgp === b.dataset.mg)); });
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
  let figGrid = null;
  App.initFigInfo();
  /* Saved figures: tabs of a few figures each, and a few periods at a time (◀ ▶), names always shown. */
  function figGridMount(box, g) {
    const st = { tab: 0, all: false, page: 0 };
    const perPage = () => (box.clientWidth < 560 ? 2 : box.clientWidth < 900 ? 4 : 6);
    function draw() {
      const cols = g.newest.filter((p) => st.all || g.recent.has(p));
      const n = perPage(), pages = Math.max(1, Math.ceil(cols.length / n));
      st.page = Math.min(st.page, pages - 1);
      const shown = cols.slice(st.page * n, st.page * n + n);
      const [, rows] = g.groups[st.tab];
      box.innerHTML = `<div class="fg-tabs" role="tablist">${g.groups.map(([l], i) => `<button type="button" role="tab" data-tab="${i}" class="${i === st.tab ? "on" : ""}">${App.esc(l)}</button>`).join("")}</div>
        <div class="fg-bar"><div class="grid-toggle"><button type="button" data-all="0" class="${st.all ? "" : "on"}">Recent</button><button type="button" data-all="1" class="${st.all ? "on" : ""}">All periods (${g.newest.length})</button></div>
          ${pages > 1 ? `<div class="fg-pager"><button type="button" data-page="-1" aria-label="Earlier periods" ${st.page ? "" : "disabled"}>◀</button><span>${st.page + 1} / ${pages}</span><button type="button" data-page="1" aria-label="Older periods" ${st.page < pages - 1 ? "" : "disabled"}>▶</button></div>` : ""}</div>
        <div class="table-wrap grid-wrap"><table class="grid"><thead><tr><th>Figure</th>${shown.map((p) => `<th class="num">${App.esc(p.period)}${p.audited === false ? "<br><span class='sub'>unaudited</span>" : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${App.figInfo(r, g.LABELS[r] || (App.FIGURES[r] || [])[0] || r)}</td>${shown.map((p) => g.cell((p.figures || {})[r])).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.tab) st.tab = +b.dataset.tab;
      else if (b.dataset.all) { st.all = b.dataset.all === "1"; st.page = 0; }
      else if (b.dataset.page) st.page += +b.dataset.page;
      draw();
    });
    let w = 0; window.addEventListener("resize", () => { if (box.clientWidth !== w) { w = box.clientWidth; draw(); } });
    draw();
  }

  const mainPrice = App.resolvePrice(classes[0].symbol, has("price") ? d.price : null, prices);
  const classSymbols = new Set(classes.map((c) => c.symbol));
  const myTargets = (alertData.targets || []).filter((t) => classSymbols.has(t.symbol));
  const status = App.priceStatus(mainPrice, v);

  /* ---------- Sections ---------- */

  function mgmtHtml(m) {
    const li = (x) => `<li>${App.esc(x.text)}${x.amount ? ` <b class="mg-amt">${App.esc(x.amount)}</b>` : ""}${x.ref ? ` <small class="mg-ref">${App.esc(x.ref)}</small>` : ""}</li>`;
    const ST = { done: ["✓", "Delivered"], "on-track": ["◐", "On track"], missed: ["✗", "Missed"], "too-early": ["…", "Too early"] };
    const track = (m.track || []).map((t) => `<li class="mg-t ${t.status}"><span class="mg-st" title="${ST[t.status][1]}">${ST[t.status][0]}</span>
      <span><b>${App.esc(t.promise)}</b>: ${App.esc(t.result)}${t.ref ? ` <small class="mg-ref">${App.esc(t.ref)}</small>` : ""}</span></li>`).join("");
    const parts = [["said", "What they said", `<ul>${(m.said || []).map(li).join("")}</ul>`], ["plans", "Plans", `<ul>${(m.plans || []).map(li).join("")}</ul>`],
      ["investing", "Where the money goes", `<ul>${(m.investing || []).map(li).join("")}</ul>`], ["track", "Promises vs delivery", `<ul class="mg-track">${track}</ul>`]];
    return `<div class="mg">
      <div class="mg-head"><h3>Management and plans</h3><small>${App.esc(m.source)}</small></div>
      ${m.takeaway ? `<p class="mg-take"><b>For investors:</b> ${App.esc(m.takeaway)}</p>` : ""}
      <div class="mg-tabs" role="tablist">${parts.map(([k, t], i) => `<button type="button" role="tab" data-mg="${k}" aria-selected="${i === 0}">${t}</button>`).join("")}</div>
      <div class="mg-grid">${parts.map(([k, t, body], i) => `<div class="mg-part ${i === 0 ? "on" : ""}" data-mgp="${k}"><h4>${t}</h4>${body}</div>`).join("")}</div>
    </div>`;
  }

  function shareholdersHtml(s) {
    const mn = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}m` : Math.abs(n).toLocaleString("en-US"));
    const chip = (x) => x.new ? `<span class="sh-chg new">New</span>`
      : x.change > 0 ? `<span class="sh-chg up">▲ ${mn(x.change)}</span>` : x.change < 0 ? `<span class="sh-chg down">▼ ${mn(-x.change)}</span>` : `<span class="sh-chg same">–</span>`;
    const COLORS = ["#2b4a8b", "#7a9bd6", "#d29a00"];
    const bar = `<div class="sh-bar" role="img" aria-label="${App.esc(s.groups.map((g) => `${g.name} ${g.pct}%`).join(", "))}">${s.groups.map((g, i) =>
      `<span style="width:${g.pct}%;background:${COLORS[i % 3]}"></span>`).join("")}</div>
      <div class="sh-legend">${s.groups.map((g, i) => `<span><i style="background:${COLORS[i % 3]}"></i>${App.esc(g.name)} <b>${g.pct}%</b></span>`).join("")}</div>`;
    const dir = (s.directors || []).reduce((a, x) => a + x.shares, 0);
    const holderDiff = App.isNum(s.publicHoldersPrev) ? s.publicHolders - s.publicHoldersPrev : null;
    const facts = `<div class="sh-facts">
      <div><small>Public float</small><b>${s.publicFloat}%</b></div>
      <div><small>Public shareholders</small><b>${s.publicHolders.toLocaleString("en-US")}</b>${holderDiff ? `<em class="${holderDiff > 0 ? "up" : "down"}">${holderDiff > 0 ? "▲" : "▼"} ${Math.abs(holderDiff).toLocaleString("en-US")} in the quarter</em>` : ""}</div>
      <div><small>Directors own</small><b>${mn(dir)} shares</b><em>${(s.directors || []).map((x) => App.esc(x.name)).join(", ") || "none"}</em></div></div>`;
    const moved = s.top.filter((x) => x.new || x.change);
    const buyers = moved.filter((x) => x.new || x.change > 0).sort((a, b) => (b.new ? b.shares : b.change) - (a.new ? a.shares : a.change));
    const sellers = moved.filter((x) => x.change < 0).sort((a, b) => a.change - b.change);
    const mv = (x) => `<li><span>${App.esc(x.name)}</span>${x.new ? `<span class="sh-chg new">New, ${mn(x.shares)}</span>` : chip(x)}</li>`;
    const TOP = 4, more = (list) => (list.length > TOP ? `<li class="sh-smaller">and ${list.length - TOP} smaller ${list.length - TOP === 1 ? "change" : "changes"}</li>` : "");
    const moves = `<div class="sh-moves"><div><h4>Bought</h4><ul>${buyers.slice(0, TOP).map(mv).join("") || "<li>None</li>"}${more(buyers)}</ul></div>
      <div><h4>Sold</h4><ul>${sellers.slice(0, TOP).map(mv).join("")}${more(sellers)}${(s.gone || []).map((g) => `<li><span>${App.esc(g.name)}</span><span class="sh-chg down">Left the top 20 (had ${mn(g.prevShares)})</span></li>`).join("") || (sellers.length ? "" : "<li>None</li>")}</ul></div></div>`;
    const row = (x, i) => `<li class="${i >= 10 ? "sh-more" : ""}"><span class="sh-rank">${i + 1}</span><span class="sh-name">${App.esc(x.name)}${x.note ? ` <span class="sh-note" title="${App.esc(x.note)}">ⓘ</span>` : ""}</span>
      <span class="sh-pct">${x.pct.toFixed(2)}%</span>${chip(x)}</li>`;
    return `<h2>Shareholders</h2>
      <p class="section-lead">${App.esc(s.takeaway)}</p>
      ${bar}${facts}
      <h3 class="sh-h">Biggest moves since ${App.date(s.compareTo)}</h3>${moves}
      <h3 class="sh-h">Top 20 shareholders</h3>
      <ol class="sh-list" data-open="false">${s.top.map(row).join("")}</ol>
      ${s.top.length > 10 ? `<button type="button" class="sh-toggle" data-sh-toggle>Show all ${s.top.length}</button>` : ""}
      <p class="sh-src">${App.esc(s.source)}. Change = shares bought or sold since the previous quarter.</p>`;
  }
  /* ---------- Graphic helpers for the company page ---------- */
  /* Price against fair value as a half-circle gauge, then fair, buy and strong-buy price tiles,
     each with how far today's price is from it. */
  function valueStrip() {
    const price = mainPrice && mainPrice.value;
    if (!App.isNum(price) || !App.isNum(v.fairValue)) return "";
    const gap = (price / v.fairValue - 1) * 100, clamp = Math.max(-60, Math.min(100, gap));
    const ang = (clamp + 60) / 160 * 180;                       // −60% (left) … +100% (right)
    const R = 46, cx = 60, cy = 56, rad = (a) => Math.PI - a * Math.PI / 180;
    const nx = cx + R * Math.cos(rad(ang)), ny = cy - R * Math.sin(rad(ang));
    const arc = (a0, a1, c) => { const x0 = cx + R * Math.cos(rad(a0)), y0 = cy - R * Math.sin(rad(a0)), x1 = cx + R * Math.cos(rad(a1)), y1 = cy - R * Math.sin(rad(a1));
      return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${c}" stroke-width="12" fill="none"/>`; };
    const fairA = 60 / 160 * 180;
    const tile = (ic, label, val, cls) => { if (!App.isNum(val)) return "";
      const g = (price / val - 1) * 100, below = g <= 0;
      return `<div class="vs-tile ${cls}"><span class="vs-ic" aria-hidden="true">${ic}</span><span class="vs-l">${label}</span><b>${App.rs(val)}</b>
        <span class="gap ${below ? "below" : "above"}"><i>${below ? "▼" : "▲"}</i>${Math.abs(g).toFixed(0)}%<span class="gw"> ${below ? "below" : "above"}</span></span></div>`; };
    return `<div class="vstrip">
      <div class="vs-gauge" role="img" aria-label="Price ${Math.abs(gap).toFixed(0)}% ${gap > 0 ? "above" : "below"} fair value">
        <svg viewBox="0 0 120 66">${arc(0, fairA * 0.55, "var(--zone-strong)")}${arc(fairA * 0.55, fairA, "var(--zone-buy)")}${arc(fairA, fairA + 25, "var(--zone-fair)")}${arc(fairA + 25, 180, "var(--zone-over)")}
          <line class="vs-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="var(--ink)"/></svg>
        <div class="vs-gt"><b class="${gap > 0 ? "down" : "up"}">${Math.abs(gap).toFixed(0)}%</b> ${gap > 0 ? "above" : "below"} fair value</div></div>
      ${tile("🎯", "Fair value", v.fairValue, "fv")}${tile("🛒", "Buy price", v.buyPrice, "bp")}${tile("💎", "Strong buy", v.strongBuyPrice, "sb")}</div>`;
  }
  const ICON_RULES = [[/roe|return on equity|return on capital|roce/i, "📈"], [/debt|borrow|lever/i, "🏦"], [/cash|fcf|flow/i, "💵"], [/dividend|yield|payout/i, "💰"],
    [/p\/e|pe\b|earnings|eps|profit/i, "🧮"], [/nav|book|p\/b/i, "📘"], [/market cap|ev\b|ev \//i, "🏢"], [/wacc|cost of equity|required|beta|bond/i, "⚖️"],
    [/growth|reinvest/i, "🌱"], [/revenue|sales|margin/i, "📊"], [/capex|depreciat|maintenance|invest/i, "🏗️"], [/quarter|month|interim|result/i, "🗓️"],
    [/balance|equity/i, "🧱"], [/group|merger|subsidiar|sold|acquir/i, "🔀"], [/tax/i, "🧾"], [/price|share/i, "💹"]];
  const iconFor = (t) => (ICON_RULES.find(([re]) => re.test(String(t || ""))) || [0, "🔹"])[1];

  /* Your price alerts (set with /alert in Telegram), shown under the price ladder as cards:
     bell, the target in large type, a "how close" meter from today's price to the target, and
     a status pill (waiting, or sent with its date). */
  const BELL = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>`;
  function alertLines() {
    if (!myTargets.length) return "";
    return `<div class="alert-cards">${myTargets.map((t) => {
      const pr = App.resolvePrice(t.symbol, t.symbol === classes[0].symbol && has("price") ? d.price : null, prices);
      const down = t.direction === "below";
      let meter = "", pill;
      if (t.fired) pill = `<span class="al-pill sent">✓ Sent ${App.date(t.fired.at.slice(0, 10))} at ${App.price(t.fired.price)}</span>`;
      else {
        pill = `<span class="al-pill wait">Waiting</span>`;
        if (pr) {
          const gapPct = ((t.price - pr.value) / pr.value) * 100;          // negative: target below today
          const reached = down ? pr.value <= t.price : pr.value >= t.price;
          const close = reached ? 100 : Math.max(4, 100 - Math.abs(gapPct) / 25 * 100);   // 25% away or more = empty
          meter = `<div class="al-meter" role="img" aria-label="Today ${App.price(pr.value)}, ${Math.abs(gapPct).toFixed(1)}% from the alert">
              <div class="al-track"><div class="al-fill" style="width:${close.toFixed(0)}%"></div></div>
              <div class="al-meter-t"><span>Today <b>${App.price(pr.value)}</b></span><span><b>${reached ? "reached" : `${Math.abs(gapPct).toFixed(1)}% to go`}</b>${reached ? "" : ` · ${App.rs(Math.abs(t.price - pr.value))} ${down ? "fall" : "rise"}`}</span></div></div>`;
        }
      }
      return `<div class="alert-card${t.fired ? " sent" : ""}">
          <div class="al-top"><span class="al-bell">${BELL}</span>
            <div class="al-what"><small>${classes.length > 1 ? `${App.esc(t.symbol)} · ` : ""}Your price alert</small>
              <div class="al-target"><span class="al-dir ${down ? "down" : "up"}">${down ? "▼" : "▲"}</span>${App.rs(t.price)}<small>${down ? "or lower" : "or higher"}</small></div></div>
            ${pill}</div>
          ${meter}${t.note ? `<div class="al-note">${App.esc(t.note)}</div>` : ""}</div>`;
    }).join("")}</div>`;
  }

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

      const rt = d._rate, tf = v && v.textFigures;
      if (rt && App.isNum(rt.published.fairValue) && App.isNum(v.fairValue) && Math.abs(v.fairValue / rt.published.fairValue - 1) >= 0.005 || (rt && rt.warnings.length)) {
        const why = rt.delta ? `the 10-year bond moved from ${rt.wasBond}% to ${rt.bond}%${rt.bondDate ? ` (trades on ${App.date(rt.bondDate)})` : ""}` : "the valuation formulas have been corrected since this analysis";
        statuses.unshift(`<div class="status warn"><b>Recalculated.</b> ${
          App.isNum(rt.published.fairValue) ? `Fair value ${App.rs(v.fairValue)} (was ${App.rs(rt.published.fairValue)}), buy price ${App.rs(v.buyPrice)} (was ${App.rs(rt.published.buyPrice)}): ` : ""
        }${why}.${rt.warnings.length ? `<br>${rt.warnings.map(App.esc).join("<br>")}` : ""}</div>`);
      }
      if (tf && App.isNum(tf.fairValue) && Math.abs(tf.fairValue - v.fairValue) >= 0.005) statuses.unshift(`<div class="status warn"><b>The written analysis has older figures.</b> It quotes fair value ${App.rs(tf.fairValue)}, buy ${App.rs(tf.buyPrice)} and strong buy ${App.rs(tf.strongBuyPrice)}; the figures here are ${App.rs(v.fairValue)}, ${App.rs(v.buyPrice)} and ${App.rs(v.strongBuyPrice)} because ${App.esc(tf.why || "they were recalculated")}. The text is rewritten at the next update or redo.</div>`);

      const sum = has("summary") ? d.summary : null;
      return `
        <div class="hero-head">${App.logo(meta)}<div><h1>${App.esc(meta.name)} ${App.Stars.button(d.ticker, meta.name)}</h1>
          <div class="hero-meta">${App.esc(d.ticker)}${meta.sector ? ", " + App.esc(meta.sector) : ""}. Analysis of ${App.date(d.analysisDate)}.</div></div></div>
        ${valueStrip()}
        <div class="hero-grid">
          <div>${sum ? `<p class="verdict">${App.esc(sum.headline || "")}</p><div class="clamp" data-lines="7">${App.md(sum.text)}</div>` : NA}</div>
          <div class="hero-prices">${rows}<div class="status-list st2">${statuses.join("")}</div></div>
        </div>
        ${has("management") ? mgmtHtml(d.management) : ""}
        <div class="ladder"><div id="ladder"></div>
          <p class="ladder-caption">${App.term("Strong-buy price", "Strong-buy price")} ${App.rs(v.strongBuyPrice)} and ${App.term("buy price", "Buy price")} ${App.rs(v.buyPrice)} come from ${App.term("fair value", "Fair value")} ${App.rs(v.fairValue)} minus a ${App.term("margin of safety", "Margin of safety")}${v.marginOfSafety ? ` of ${v.marginOfSafety.strongBuy}% and ${v.marginOfSafety.buy}%` : ""}.</p>
          ${alertLines()}</div>`;
    }, after: () => {
      const ex = has("scenarios") && d.scenarios.averages ? [d.scenarios.averages.bull] : [];
      Charts.ladder(document.getElementById("ladder"), { price: mainPrice && mainPrice.value, strongBuy: v.strongBuyPrice, buy: v.buyPrice, fair: v.fairValue, extra: ex,
        targets: myTargets.filter((t) => t.symbol === classes[0].symbol) });
    } },

    { id: "shareholders", title: "Shareholders", always: true, html: () => has("shareholders") ? shareholdersHtml(d.shareholders)
        : `<h2>Shareholders</h2><p class="section-lead">The largest shareholders and who's buying or selling. Available for this company after its next update or full redo.</p>` },
    { id: "quality", title: "Business tests", key: "quality", html: () => {
      const q = d.quality, n = q.tests.filter((t) => t.pass).length;
      return `<h2>Business tests</h2>
      <p class="section-lead">Is this a business worth owning for years? It passes ${n} of ${q.tests.length} tests; it needs 3 to count as a good business. A good business goes on the watch list, and becomes "Buy now" when a share class is at or below the buy price.</p>
      <div class="tscore" role="img" aria-label="${n} of ${q.tests.length} tests passed">${q.tests.map((t, k) => `<i class="${t.pass ? "on" : "off"}" style="--k:${k}">${t.pass ? "✓" : "✗"}</i>`).join("")}
        <b>${n}/${q.tests.length}</b><span>${n >= 3 ? "A good business" : "Not good enough yet"}</span></div>
      <div class="tests">${q.tests.map((t) => `<div class="test ${t.pass ? "pass" : "fail"}">
        <div class="test-mark" aria-hidden="true">${t.pass ? "✓" : "✗"}</div>
        <div><div class="test-label">${App.esc(t.label)} <span class="sr-only">${t.pass ? "(passed)" : "(failed)"}</span></div>
          <div class="test-value">${App.esc(t.value || "")}</div>${t.note ? `<div class="test-note">${App.esc(t.note)}</div>` : ""}</div></div>`).join("")}</div>
      ${q.assessed ? `<p class="section-lead">Assessed ${App.date(q.assessed)}.</p>` : ""}`;
    } },

    { id: "figures", title: "Key figures", key: "keyMetrics", html: () => `<h2>Key figures</h2>
      <div class="figures">${d.keyMetrics.map((m) => `<div class="figure"><div class="lbl"><span class="fig-ic" aria-hidden="true">${iconFor(m.label)}</span>${App.term(m.label)}</div>
        <div class="num">${App.esc(m.display || App.withUnit(m.value, m.unit))}</div>${m.note ? `<div class="note">${App.esc(m.note)}</div>` : ""}</div>`).join("")}${dividendFigure()}${requiredReturnFigure()}</div>` },

    { id: "results", title: "Latest results", key: "highlights", html: () => `<h2>Latest results</h2>
      <div class="highlights hcards">${d.highlights.map((h) => `<div class="hcard"><h3><span class="h-ic" aria-hidden="true">${iconFor(h.title)}</span>${App.esc(h.title || "")}</h3><div class="clamp" data-lines="5">${App.md(h.text)}</div></div>`).join("")}</div>` },

    { id: "changes", title: "What changed", always: true, html: () => {
      if (!research) return `<h2>What changed</h2><p class="section-lead">No research record yet for this company.</p>`;
      const log = (research.changeLog || []).slice().reverse();
      const periods = (research.periods || []).slice().sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
      const allNames = [...new Set(periods.flatMap((p) => Object.keys(p.figures || {})))];
      const LABELS = { revenue: "Revenue", grossProfit: "Gross profit", grossMarginPct: "Gross margin", netProfit: "Net profit", eps: "EPS",
        dividendPerShare: "Dividend per share", navPerShare: "NAV per share", roe: "Return on equity", peYearEnd: "P/E at year-end",
        operatingCashFlow: "Operating cash flow", capexPaid: "Capex paid", capexCommitted: "Capex committed", freeCashFlow: "Free cash flow",
        netDebt: "Net debt", netDebtToEbitda: "Net debt / EBITDA", debtToEquity: "Debt to equity", sharesOutstanding: "Shares outstanding",
        fxGainLoss: "Exchange gain (loss)", contractedCapex: "Contracted capex", priceYearEnd: "Share price at year-end",
        operatingProfit: "Operating profit", profitBeforeTax: "Profit before tax", incomeTax: "Income tax", netProfitOwners: "Profit, owners' share",
        financeCosts: "Finance costs", interestPaid: "Interest paid", purchasePPE: "Capex: plant and equipment", purchaseIntangibles: "Capex: intangibles",
        capexBooked: "Capex booked", depreciation: "Depreciation", depreciationAmortisation: "Depreciation and amortisation", leasePrincipal: "Lease payments",
        dividendsPaid: "Dividends paid", ebitda: "EBITDA", totalEquity: "Owners' equity", borrowings: "Borrowings", leaseLiabilities: "Lease liabilities",
        cash: "Cash", nonControllingInterest: "Minorities", taxRate: "Tax rate" };
      const order = Object.keys(LABELS);
      const names = allNames.slice().sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
      const cell = (f, extra) => {
        const cls = `num${extra ? " extra" : ""}`;
        if (!f) return `<td class="${cls}"></td>`;
        const txt = App.isNum(f.value) ? App.withUnit(f.value, f.unit) : "–";
        const tip = [f.note, f.source].filter(Boolean).join(". ");
        return `<td class="${cls}" title="${App.esc(tip)}">${txt}${f.note ? " *" : ""}</td>`;
      };
      // Newest first; the latest year-to-date with last year's same period beside it, then the years.
      const newest = periods.slice().sort((x, y) => (y.periodEnd || "").localeCompare(x.periodEnd || "") || (y.months || 0) - (x.months || 0));
      const lastAnnual = newest.find((p) => p.type === "annual");
      const ytd = newest.find((p) => p.type !== "annual" && lastAnnual && (p.periodEnd || "") > (lastAnnual.periodEnd || ""));
      const comp = ytd && newest.find((p) => p !== ytd && p.months === ytd.months && p.type === ytd.type &&
        (p.periodEnd || "").slice(5) === (ytd.periodEnd || "").slice(5) && +(p.periodEnd || "").slice(0, 4) === +(ytd.periodEnd || "").slice(0, 4) - 1);
      if (comp) { newest.splice(newest.indexOf(comp), 1); newest.splice(newest.indexOf(ytd) + 1, 0, comp); }
      const recent = new Set([ytd, comp, ...newest.filter((p) => p.type === "annual").slice(0, 3)].filter(Boolean));
      // Rows in tabs of a few figures each.
      const GROUPS = [
        ["Results", ["revenue", "grossProfit", "operatingProfit", "profitBeforeTax", "incomeTax", "netProfit", "netProfitOwners", "eps", "dividendPerShare", "financeCosts", "fxGainLoss"]],
        ["Cash and capex", ["operatingCashFlow", "interestPaid", "capexPaid", "purchasePPE", "purchaseIntangibles", "capexBooked", "capexCommitted", "contractedCapex", "depreciation", "depreciationAmortisation", "leasePrincipal", "dividendsPaid", "freeCashFlow", "ebitda"]],
        ["Balance sheet", ["totalEquity", "navPerShare", "borrowings", "leaseLiabilities", "cash", "netDebt", "nonControllingInterest", "sharesOutstanding"]],
        ["Ratios", ["roe", "grossMarginPct", "peYearEnd", "priceYearEnd", "debtToEquity", "netDebtToEbitda", "taxRate"]],
      ];
      const placed = new Set(GROUPS.flatMap((g) => g[1]));
      const groups = GROUPS.map(([label, keys]) => [label, keys.filter((k) => names.includes(k))]).filter((g) => g[1].length);
      const rest = names.filter((n) => !placed.has(n));
      if (rest.length) groups.push(["Other", rest]);
      figGrid = { newest, recent, groups, LABELS, cell };
      const figTable = names.length ? `<div class="figgrid" id="figgrid"></div>
        <p class="section-lead" style="margin-top:.5rem">Tap or hover over a figure to see its source. * means there's a note.</p>` : `<p class="na">No figures saved yet.</p>`;
      const inputs = (research.valuationInputs || []).map((v) => `<tr><td>${App.term(v.name)}</td><td>${App.esc(v.value)}</td><td>${App.esc(v.reason || "")}</td><td style="white-space:nowrap">${App.date(v.since)}</td></tr>`).join("");
      const reports = (research.reportsRead || []).map((r) => `<li>${App.esc(r.title || r.file)}${r.audited === false ? " (unaudited)" : ""}, read ${App.date(r.readOn)}</li>`).join("");
      return `<h2>What changed</h2>
        <p class="section-lead">Each update builds on the saved research record, reading only new reports.</p>
        ${log.length >= 2 ? `<div class="chart"><h3>Fair value over time</h3><div id="timeline"></div>
          <div class="legend"><span><i style="background:var(--ink)"></i>Fair value</span><span><i style="background:var(--good)"></i>Buy price</span><span><i style="background:var(--accent)"></i>Share price at the time</span></div></div>`
          : `<p class="section-lead">A fair-value history chart appears after the next update.</p>`}
        ${(research.openQuestions || []).length ? `<details class="more"><summary>To check in the next report (${research.openQuestions.length})</summary><ul>${research.openQuestions.map((q) => `<li>${App.esc(q)}</li>`).join("")}</ul></details>` : ""}
        <details class="more"><summary>Saved figures by period</summary>${figTable}</details>
        ${inputs ? `<details class="more"><summary>Valuation inputs and reasons</summary><div class="table-wrap"><table><thead><tr><th>Input</th><th>Value</th><th>Reason</th><th>Since</th></tr></thead><tbody>${inputs}</tbody></table></div></details>` : ""}
        ${reports ? `<details class="more"><summary>Reports read</summary><ul>${reports}</ul></details>` : ""}`;
    }, after: () => {
      const el = document.getElementById("timeline"); if (el) Charts.timeline(el, research.changeLog || []);
      const box = document.getElementById("figgrid");
      if (box && figGrid) figGridMount(box, figGrid);
    } },
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
      const avg = s.averages || {}, mx = Math.max(...["bear", "base", "bull"].map((k) => avg[k]).filter(App.isNum), 1), pr = mainPrice && mainPrice.value;
      const caseCard = (k, ic, label) => !App.isNum(avg[k]) ? "" : `<div class="case ${k}"><div class="case-h"><span aria-hidden="true">${ic}</span>${label}${App.isNum(w[k]) ? `<em>${w[k]}%</em>` : ""}</div>
          <div class="case-bar"><div style="height:${(avg[k] / Math.max(mx, pr || 0) * 100).toFixed(0)}%"></div>${App.isNum(pr) ? `<i style="bottom:${(pr / Math.max(mx, pr) * 100).toFixed(0)}%"></i>` : ""}</div>
          <b>${App.rs(avg[k])}</b><small>average of the methods</small></div>`;
      return `<h2>Assumptions</h2>
        ${s.averages ? `<div class="cases">${caseCard("bear", "🐻", "Bear")}${caseCard("base", "⚖️", "Base")}${caseCard("bull", "🐂", "Bull")}
          ${App.isNum(pr) ? `<p class="cases-note"><i></i> today's price ${App.price(pr)}</p>` : ""}</div>` : ""}
        <div class="table-wrap"><table><thead><tr><th></th>${head}</tr></thead><tbody>
          ${(s.assumptions || []).map((a) => `<tr><td>${App.term(a.label)}</td><td>${App.esc(a.bear ?? "")}</td><td>${App.esc(a.base ?? "")}</td><td>${App.esc(a.bull ?? "")}</td></tr>`).join("")}
          ${s.averages ? `<tr class="total"><td>Average of the methods</td><td>${App.rs(s.averages.bear)}</td><td>${App.rs(s.averages.base)}</td><td>${App.rs(s.averages.bull)}</td></tr>` : ""}
        </tbody></table></div>
        ${s.common ? `<div style="margin-top:1rem"><h3 style="margin-bottom:.3rem">Shared by all cases</h3><div class="clamp" data-lines="4">${App.md(s.common)}</div></div>` : ""}
        ${v.note ? `<div class="clamp section-lead" data-lines="3" style="margin-top:.6rem">${App.esc(v.note)}</div>` : ""}`;
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

    { id: "whatif", title: "What if?", always: true, html: () => has("modelInputs") ? `<h2>What if?</h2><div id="whatif"></div>`
        : `<h2>What if?</h2><p class="section-lead">Change the valuation inputs and see the fair value move. Available for this company after its next update or redo.</p>`,
      after: () => has("modelInputs") && window.WhatIf && WhatIf.mount(document.getElementById("whatif"), d, mainPrice && mainPrice.value) },

    { id: "buy-plan", title: "Buy plan", key: "buyPlan", html: () => {
      const b = d.buyPlan, price = mainPrice && mainPrice.value;
      const tiers = b.tiers.map((t) => {
        const hit = App.isNum(price) && price <= t.maxPrice;
        const gap = App.isNum(price) ? ((price - t.maxPrice) / price) * 100 : null;
        const fill = hit ? 100 : gap !== null ? Math.max(3, 100 - gap / 60 * 100) : 0;   // 60% or more away = nearly empty
        return `<div class="tier ${hit ? "hit" : ""}"><span class="shares">${App.num(t.shares)} shares</span><span>at up to <b>${App.rs(t.maxPrice)}</b></span>
          <span class="state">${hit ? "✓ Price is in range now" : gap !== null ? `Needs a ${gap.toFixed(0)}% fall` : ""}</span>
          ${gap !== null ? `<div class="tier-bar" aria-hidden="true"><div style="width:${fill.toFixed(0)}%"></div></div>` : ""}</div>`;
      }).join("");
      return `<h2>Buy plan</h2>
        <div class="plan-sum">
          ${App.isNum(b.totalShares) ? `<div><span><i aria-hidden="true">📦</i> Total</span><b>${App.num(b.totalShares)} shares</b></div>` : ""}
          ${App.isNum(b.averagePrice) ? `<div><span><i aria-hidden="true">⚖️</i> Average price</span><b>${App.price(b.averagePrice)}</b></div>` : ""}
          ${App.isNum(b.totalCost) ? `<div><span><i aria-hidden="true">💵</i> Total cost</span><b>Rs ${App.num(b.totalCost, 0)}</b></div>` : ""}
          ${App.isNum(price) && App.isNum(b.totalShares) ? `<div><span><i aria-hidden="true">💹</i> Cost at today's price</span><b>Rs ${App.num(Math.round(price * b.totalShares), 0)}</b></div>` : ""}
        </div>
        <div class="tiers">${tiers}</div>
        ${b.note ? `<p style="margin-top:1rem">${App.esc(b.note)}</p>` : ""}
        ${b.realism ? `<h3 style="margin:1rem 0 .3rem">How realistic is it?</h3>${App.md(b.realism)}` : ""}`;
    } },

    { id: "change", title: "What would change the view", key: "changeMyView", html: () => `<h2>What would change the view</h2>
      <div class="cmv cmv2"><div class="higher"><h3><span class="cmv-ic up" aria-hidden="true">▲</span>Supports a higher value</h3><ul>${(d.changeMyView.higher || []).map((x) => `<li><i aria-hidden="true">${iconFor(x)}</i><span>${App.esc(x)}</span></li>`).join("")}</ul></div>
      <div class="lower"><h3><span class="cmv-ic down" aria-hidden="true">▼</span>Supports a lower value</h3><ul>${(d.changeMyView.lower || []).map((x) => `<li><i aria-hidden="true">${iconFor(x)}</i><span>${App.esc(x)}</span></li>`).join("")}</ul></div></div>` },

    { id: "full", title: "Full analysis", key: "fullText", html: () => `<h2>Full analysis</h2>
      ${has("notes") && d.notes.disclaimer ? `<p class="disclaimer">${App.esc(d.notes.disclaimer)}</p>` : ""}
      ${has("resultsCovered") && Array.isArray(d.resultsCovered.sources) ? `<p class="disclaimer">Sources: ${d.resultsCovered.sources.map(App.esc).join("; ")}.</p>` : ""}
      <details class="more"><summary>Show the complete original text</summary><div class="fulltext">${App.esc(d.fullText)}</div></details>` },
  ];

  /* Sections the site doesn't know yet are listed at the end. */
  const knownKeys = new Set(["schemaVersion", "ticker", "analysisDate", "company", "shareClasses", "resultsCovered", "price", "summary", "valuation",
    "keyMetrics", "highlights", "shareholders", "management", "history", "methodReadings", "models", "modelInputs", "modelsNote", "scenarios", "sensitivity", "buyPlan", "changeMyView", "notes", "fullText", "_build",
    "quality", "dividend", "requiredReturn"]);
  const unknown = Object.keys(d).filter((k) => !knownKeys.has(k));
  /* Latest dividend per share, as one more key-figure tile. */
  function dividendFigure() {
    const dv = d.dividend;
    if (!dv || !App.isNum(dv.perShare)) return "";
    const latest = dv.latest && App.isNum(dv.latest.perShare) ? `Latest: ${App.rs2(dv.latest.perShare)} ${dv.latest.label || ""}` : "";
    return `<div class="figure"><div class="lbl">Dividend per share</div><div class="num">${App.rs2(dv.perShare)}</div>
      <div class="note">${App.esc([dv.label, latest].filter(Boolean).join(". "))}</div></div>`;
  }

  /* Required return (cost of equity) with the beta; hover or tap shows how it's built up. */
  function requiredReturnFigure() {
    if (!has("requiredReturn")) return "";
    const r = d.requiredReturn, c = r.costOfEquity || {}, w = r.wacc;
    const pc = (x) => (App.isNum(x) ? `${App.num(x)}%` : "–");
    const erp = App.isNum(r.matureERP) && App.isNum(r.countryPremium) ? r.matureERP + r.countryPremium : null;
    const rows = [
      ["Risk-free rate", pc(r.riskFree), "10-year rupee bond less Sri Lanka's default spread"],
      ["Beta", App.isNum(r.beta) ? App.num(r.beta) : "–", r.betaBasis || ""],
      ["Share risk premium", pc(erp), `${pc(r.matureERP)} mature market + ${pc(r.countryPremium)} Sri Lanka`],
      ["Cost of equity", pc(c.base), `${pc(r.riskFree)} + ${App.isNum(r.beta) ? App.num(r.beta) : "–"} × ${pc(erp)}; bear ${pc(c.bear)}, bull ${pc(c.bull)}`],
    ];
    if (w) rows.push(["WACC", pc(w.base), `Used by the DCF. Debt ${pc(r.debtWeight)} of the company at ${pc(r.costOfDebt)} before tax; bear ${pc(w.bear)}, bull ${pc(w.bull)}`]);
    const tip = rows.map(([k, v, x]) => `<div class="rr-row"><b>${App.esc(k)}</b><span>${App.esc(v)}</span>${x ? `<small>${App.esc(x)}</small>` : ""}</div>`).join("");
    return `<div class="figure rr" tabindex="0" aria-describedby="rr-tip"><div class="lbl">${App.term("Required return")} <span class="rr-i" aria-hidden="true">ⓘ</span></div>
      <div class="num">${pc(c.base)}</div>
      <div class="note">Beta ${App.isNum(r.beta) ? App.num(r.beta) : "–"}${w ? `, WACC ${pc(w.base)}` : ""}${r.asOf ? `. ${App.date(r.asOf)}` : ""}</div>
      <div class="rr-tip" id="rr-tip" role="tooltip">${tip}${r.note ? `<p>${App.esc(r.note)}</p>` : ""}</div></div>`;
  }

  /* Extra research sections (decision box, moat, Sri Lanka checks, key ratios, …):
     one card each, label beside value, with a row of links to jump between them. */
  const STATUS = { ok: "good", watch: "warn", risk: "bad", warning: "warn", fail: "bad", pass: "good" };
  function statusBadge(word) {
    const cls = STATUS[String(word).toLowerCase()];
    return cls ? `<span class="badge ${cls}">${App.esc(word)}</span>` : null;
  }
  function moreValue(val) {
    if (val === null || val === undefined || val === "") return "–";
    if (Array.isArray(val)) return `<ul class="more-list">${val.map((x) => `<li>${moreValue(x)}</li>`).join("")}</ul>`;
    if (typeof val === "object") return `<div class="more-rows nested">${Object.entries(val).map(([k, x]) => moreRow(k, x)).join("")}</div>`;
    const text = String(val);
    const whole = statusBadge(text.trim());
    if (whole) return whole;
    // "Watch: policy rate raised…" → badge + text
    const m = text.match(/^(OK|Watch|Risk|Warning|Pass|Fail)\s*[:–-]\s*(.*)$/is);
    if (m) return `${statusBadge(m[1])} ${App.esc(m[2])}`;
    // "2023 30% · 2024 16% · …" → a row of years
    const parts = text.split(" · ");
    const PERIOD = /^((?:\d{4}(?:\/\d{2})?|H[12] \d{4}|Q[1-4] \d{4}|(?:Mar|Jun|Sep|Dec) \d{4}|now|\d+ months to [A-Za-z]+ \d{4}|last 12 months|\d{4} so far))\s+(.*)$/i;
    const periods = parts.map((x) => x.match(PERIOD));
    if (parts.length >= 3 || (parts.length === 2 && periods.every(Boolean))) return `<div class="trend">${parts.map((x, i) => {
      const y = periods[i];
      return y ? `<span><small>${App.esc(y[1])}</small>${App.esc(y[2])}</span>` : `<span>${App.esc(x)}</span>`;
    }).join("")}</div>`;
    return App.esc(text);
  }
  function moreRow(k, x) {
    return `<div class="more-row"><div class="more-key">${App.esc(k)}</div><div class="more-val">${moreValue(x)}</div></div>`;
  }
  const SHOW_ROWS = 8;
  const MORE_IC = [[/moat|business/i, "🏰"], [/management|governance/i, "👔"], [/alert/i, "🔔"], [/accounting/i, "🧾"], [/peer|comparison/i, "🆚"],
    [/decision/i, "🧭"], [/portfolio/i, "🧺"], [/ratio|trend/i, "📊"], [/case|sell rule/i, "📝"], [/sri lanka|country/i, "🇱🇰"], [/crisis|stress/i, "🌪️"], [/broker/i, "🗞️"]];
  function moreCard(k, i) {
    const val = d[k];
    const warn = /doesn.t cover|not covered|limitations/i.test(k);
    let body;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const rows = Object.entries(val).map(([a, b]) => moreRow(a, b));
      body = `<div class="more-rows">${rows.slice(0, SHOW_ROWS).join("")}</div>`
        + (rows.length > SHOW_ROWS ? `<details class="more-rest"><summary>Show all ${rows.length}</summary><div class="more-rows">${rows.slice(SHOW_ROWS).join("")}</div></details>` : "");
    } else {
      body = `<div class="more-val">${moreValue(val)}</div>`;
    }
    const ic = warn ? "⚠️" : (MORE_IC.find(([re]) => re.test(k)) || [0, "📄"])[1];
    const n = val && typeof val === "object" ? (Array.isArray(val) ? val.length : Object.keys(val).length) : 0;
    return `<details class="more-card mtile${warn ? " warn" : ""}" id="more-${i}"><summary><span class="mt-ic2" aria-hidden="true">${ic}</span>
      <span><b>${App.esc(k.replace(/\s*\(.*\)$/, ""))}</b>${n ? `<small>${n} item${n === 1 ? "" : "s"}</small>` : ""}</span></summary>${body}</details>`;
  }
  if (unknown.length) sections.push({ id: "other", title: "More research", always: true, html: () => `<h2>More research</h2>
    <p class="section-lead">Tap a topic to open it.</p><div class="mtiles">${unknown.map(moreCard).join("")}</div>` });

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
    /* an icon before each section heading (same as in the side list) */
    content.querySelectorAll("section.section > h2:first-of-type").forEach((h) => {
      const ic = (window.SEC_IC || {})[h.parentElement.id]; if (ic && !h.querySelector(".h2-ic")) h.insertAdjacentHTML("afterbegin", `<span class="h2-ic" aria-hidden="true">${ic}</span>`);
    });
    if (App.reveal) App.reveal(content, ".section");
    content.addEventListener("toggle", (e) => {
      const el = e.target; if (!el.open || !el.matches(".mtiles > .mtile")) return;
      el.parentElement.querySelectorAll(":scope > details[open]").forEach((o) => { if (o !== el) o.open = false; });
      if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, true);
    /* Long paragraphs show their first few lines with "Read more". */
    content.querySelectorAll(".clamp").forEach((el) => {
      el.style.setProperty("--lines", el.dataset.lines || 6);
      if (el.scrollHeight <= el.clientHeight + 4) { el.classList.add("fits"); return; }
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "clamp-btn"; btn.textContent = "Read more";
      btn.onclick = () => { const open = el.classList.toggle("open"); btn.textContent = open ? "Show less" : "Read more"; };
      el.after(btn);
    });
  }
  const SEC_IC = window.SEC_IC = { overview: "🏠", shareholders: "👥", quality: "✅", figures: "🔢", results: "🗓️", changes: "🔄", methods: "🧮", history: "📈",
    scenarios: "🎲", sensitivity: "🌡️", whatif: "🎛️", "buy-plan": "🛒", change: "⚖️", full: "📄", other: "🔎" };
  toc.innerHTML = sections.map((s) => `<a href="#${s.id}"><span class="toc-ic" aria-hidden="true">${SEC_IC[s.id] || "•"}</span>${App.esc(s.title)}</a>`).join("");

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
