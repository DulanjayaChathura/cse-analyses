/* Home page: one card per company. */
"use strict";

(async function () {
  App.init();
  const cardsEl = document.getElementById("cards");
  const updatedEl = document.getElementById("updated");
  let index, prices;
  try {
    [index, prices] = await Promise.all([App.load("data/index.json"), App.loadOptional("data/prices.json", {})]);
  } catch (e) {
    cardsEl.innerHTML = `<div class="empty">The company list couldn't be loaded. Reload the page; if it keeps failing, check the latest run under the repository's Actions tab.</div>`;
    updatedEl.textContent = "";
    return;
  }
  /* Gap between the current price and fair value, as a fraction: -0.2 means
     20% below fair value. Cards are ordered from the lowest gap (cheapest
     against fair value) to the highest; companies without a price or fair
     value go last, in name order. */
  function gap(c) {
    const pr = App.resolvePrice(c.ticker, c.price, prices);
    const fv = c.valuation && c.valuation.fairValue;
    return pr && App.isNum(fv) && fv > 0 ? pr.value / fv - 1 : null;
  }
  const companies = (index.companies || []).slice()
    .map((c) => ({ c, g: gap(c) }))
    .sort((a, b) => (a.g === null) - (b.g === null) || (a.g ?? 0) - (b.g ?? 0) || a.c.name.localeCompare(b.c.name))
    .map((x) => x.c);
  // "57 companies" and when prices were last updated, as two chips; a live dot when prices are from today.
  const pricesToday = prices.updatedAt && prices.updatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10);
  updatedEl.innerHTML = `<span class="hchip"><span aria-hidden="true">🏢</span>${companies.length} ${companies.length === 1 ? "company" : "companies"}</span>` +
    (prices.updatedAt ? `<span class="hchip"><span class="live${pricesToday ? " on" : ""}" aria-hidden="true"></span>Prices updated ${App.date(prices.updatedAt.slice(0, 10))}</span>` : "");

  function card(c) {
    const lines = c.shareClasses.map((sc) => {
      const pr = App.resolvePrice(sc.symbol, sc.symbol === c.ticker ? c.price : null, prices);
      const chg = pr && pr.source === "cse" && App.isNum(pr.changePct) && pr.changePct !== 0
        ? `<span class="chg ${pr.changePct > 0 ? "up" : "down"}">${App.signedPct(pr.changePct)}</span>` : "";
      return { sc, pr, html: `<div class="price-line"><span class="sym">${App.esc(sc.symbol)} ${App.esc(sc.label || "")}</span><span><span class="val">${pr ? App.price(pr.value) : "–"}</span>${chg}</span></div>` };
    });
    const main = lines[0] && lines[0].pr;
    const v = c.valuation || {};
    const st = App.priceStatus(main, v);
    const badges = [];
    const cat = catOf(c);
    if (cat) badges.push(`<span class="badge ${cat.cls}" title="${App.esc((c.quality && c.quality.reason) || "")}">Category ${cat.n}: ${cat.name}</span>`);
    if (App.isRecentResearch(c.latestResearch)) badges.push(`<span class="badge new">${c.latestResearch.kind === "updated" ? "Updated" : "New research"} ${App.date(c.latestResearch.date)}</span>`);
    // (where the price sits against buy and fair value is now shown by the pills under the price bar)
    const rs = App.resultsStatus(c.resultsCovered, c.fiscalYearEnd);
    if (rs && rs.level !== "ok") badges.push(`<span class="badge ${rs.level}">Analysis may be out of date</span>`);
    if (main && main.source === "analysis") badges.push(`<span class="badge muted">Price from analysis</span>`);
    if (main && main.feedStale) badges.push(`<span class="badge warn">Price not updated recently</span>`);
    if (main && main.noTradeSince) badges.push(`<span class="badge muted">No trade since ${App.date(main.noTradeSince)}</span>`);

    // Search looks at the company name only: "dia" finds every name containing those letters.
    return `<div class="card-wrap${App.Stars.has(c.ticker) ? " is-starred" : ""}" data-search="${App.esc(c.name.toLowerCase())}">${App.Stars.button(c.ticker, c.name)}<a class="card" href="company.html?t=${encodeURIComponent(c.ticker)}">
      ${c.logo ? `<img class="card-wm" src="${App.esc(c.logo)}" alt="" aria-hidden="true" loading="lazy" onerror="this.remove()">` : ""}
      ${cat ? `<span class="card-flag ${cat.cls}">${{ 1: "🛒", 2: "👀", 3: "⛔" }[cat.n]} ${cat.name}</span>` : ""}
      <div class="card-top">${App.logo(c)}<div><div class="card-name">${App.esc(c.name)}</div><div class="card-sector">${App.esc(c.sector || "")}</div></div></div>
      <div class="prices">${lines.map((l) => l.html).join("")}</div>
      ${main ? Charts.mini({ price: main.value, strongBuy: v.strongBuyPrice, buy: v.buyPrice, fair: v.fairValue }) : ""}
      ${gapPills(main && main.value, v)}
      <div class="card-levels"><span>Analysis ${App.date(c.analysisDate)}</span></div>
      ${dividendLine(c.dividend)}
      <div class="badges">${badges.join("")}</div>
    </a></div>`;
  }

  /* How far today's price is from the buy price and the fair value, as two pills. */
  function gapPills(price, v) {
    if (!App.isNum(price)) return "";
    const pill = (lvl, label) => { if (!App.isNum(lvl) || lvl <= 0) return "";
      const g = (price / lvl - 1) * 100, below = g <= 0;
      return `<span class="gap ${below ? "below" : "above"}"><i>${below ? "▼" : "▲"}</i>${Math.abs(g).toFixed(1)}% ${below ? "below" : "above"} ${label}</span>`; };
    return `<div class="gaps">${pill(v.buyPrice, "buy")}${pill(v.fairValue, "fair value")}</div>`;
  }

  /* "Dividend Rs 0.95 for 2025/26 · Rs 0.25 interim for 2026/27" (per share). */
  function dividendLine(d) {
    if (!d || !App.isNum(d.perShare)) return "";
    const part = (x) => `<b>${App.rs2(x.perShare)}</b> ${App.esc(x.label || "")}`;
    const latest = d.latest && App.isNum(d.latest.perShare) ? `<span>Latest: ${part(d.latest)}</span>` : "";
    const tip = [d.note, d.source && `Source: ${d.source}`, d.latest && d.latest.source && `Latest: ${d.latest.source}`].filter(Boolean).join("\n");
    return `<div class="card-dividend" title="${App.esc(tip)}"><span>Dividend per share ${part(d)}</span>${latest}</div>`;
  }

  /* A company's category, from its business tests and the latest price of each share class. */
  function catOf(c) {
    return App.category(c.quality, c.valuation, c.shareClasses.map((sc) => App.resolvePrice(sc.symbol, sc.symbol === c.ticker ? c.price : null, prices)));
  }

  const sectorOf = App.sectorOf;
  let groupBy = "category";
  try { if (localStorage.getItem("groupBy") === "sector") groupBy = "sector"; } catch (e) { /* storage unavailable */ }

  /* Cards are grouped by category (or by sector, with the toggle); inside a group the order stays lowest gap first. */
  function render() {
    if (groupBy === "sector") return renderSectors();
    if (!companies.length) {
      cardsEl.innerHTML = `<div class="empty">No companies yet. Add an analysis file to the <b>data</b> folder in GitHub and it will appear here about a minute later.</div>`;
      return;
    }
    // Starred companies go first in their category (keeping the usual order among them).
    const ordered = companies.filter((c) => App.Stars.has(c.ticker)).concat(companies.filter((c) => !App.Stars.has(c.ticker)));
    const groups = [1, 2, 3].map((n) => ({ cat: App.CATEGORIES[n], list: ordered.filter((c) => (catOf(c) || {}).n === n) }));
    const unrated = ordered.filter((c) => !catOf(c));
    cardsEl.innerHTML = groups.map((g) => `<section class="cat-group">
        <h2><span class="cat-num ${g.cat.cls}">${g.cat.n}</span>${g.cat.name} <span class="cat-count">${g.list.length}</span></h2>
        <p class="cat-lead">${g.cat.lead}</p>
        ${g.list.length ? `<div class="cards">${g.list.map(card).join("")}</div>`
          : `<p class="cat-empty">${g.cat.n === 1 ? "No company is at or below its buy price today." : "None."}</p>`}
      </section>`).join("")
      + (unrated.length ? `<section class="cat-group"><h2>Not rated yet <span class="cat-count">${unrated.length}</span></h2><div class="cards">${unrated.map(card).join("")}</div></section>` : "");
    if (App.reveal) App.reveal(cardsEl, ".card-wrap");
    // Overview above the cards: one tile per category with its count and share of all companies;
    // tap a tile to jump to that group.
    const ov = document.getElementById("cat-overview");
    if (ov) {
      const all = groups.reduce((a, g) => a + g.list.length, 0) + unrated.length || 1;
      const IC = { 1: "🛒", 2: "👀", 3: "⛔" };
      cardsEl.querySelectorAll(".cat-group").forEach((sec, k) => { sec.id = sec.id || `cat-${k + 1}`; });
      ov.innerHTML = groups.map((g, k) => `<a class="cov ${g.cat.cls}" href="#cat-${k + 1}"><span class="cov-ic" aria-hidden="true">${IC[g.cat.n]}</span>
          <span class="cov-t"><small>Category ${g.cat.n}</small>${g.cat.name}</span><b>${g.list.length}</b>
          <span class="cov-bar"><i style="width:${(g.list.length / all * 100).toFixed(1)}%"></i></span></a>`).join("");
      if (App.reveal) App.reveal(ov.parentElement, ".cat-overview");
    }
  }
  /* Sector view: one group per sector, cards inside ordered Buy now → Watch → Avoid, then lowest gap;
     the overview tiles become sector tiles, each with a small bar of its categories. */
  function renderSectors() {
    const ordered = companies.filter((c) => App.Stars.has(c.ticker)).concat(companies.filter((c) => !App.Stars.has(c.ticker)));
    const byName = new Map();
    ordered.forEach((c) => { const [name, ic] = sectorOf(c); if (!byName.has(name)) byName.set(name, { name, ic, list: [] }); byName.get(name).list.push(c); });
    const rank = (c) => (catOf(c) || { n: 4 }).n;
    const groups = [...byName.values()].sort((a, b) => (a.name === "Other") - (b.name === "Other") || b.list.length - a.list.length || a.name.localeCompare(b.name));
    groups.forEach((g) => { g.list = g.list.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c); });
    const mix = (list) => [1, 2, 3].map((n) => ({ n, k: list.filter((c) => (catOf(c) || {}).n === n).length }));
    const IC = { 1: "🛒", 2: "👀", 3: "⛔" };
    cardsEl.innerHTML = groups.map((g, k) => `<section class="cat-group sec-group" id="sec-${k + 1}">
        <h2><span class="sec-ic" aria-hidden="true">${g.ic}</span>${App.esc(g.name)} <span class="cat-count">${g.list.length}</span>
          <span class="sec-mix">${mix(g.list).filter((m) => m.k).map((m) => `<span class="sm ${App.CATEGORIES[m.n].cls}" title="${App.esc(App.CATEGORIES[m.n].name)}">${IC[m.n]} ${m.k}</span>`).join("")}</span></h2>
        <div class="cards">${g.list.map(card).join("")}</div></section>`).join("");
    if (App.reveal) App.reveal(cardsEl, ".card-wrap");
    const ov = document.getElementById("cat-overview");
    if (ov) {
      ov.innerHTML = `<div class="sec-tiles">${groups.map((g, k) => `<a class="sct" href="#sec-${k + 1}" style="--i:${k}"><span class="sct-ic" aria-hidden="true">${g.ic}</span>
          <span class="sct-t">${App.esc(g.name)}</span><b>${g.list.length}</b>
          <span class="sct-bar" aria-hidden="true">${mix(g.list).map((m) => m.k ? `<i class="${App.CATEGORIES[m.n].cls}" style="flex:${m.k}"></i>` : "").join("")}${
            g.list.length - mix(g.list).reduce((a, m) => a + m.k, 0) ? `<i class="none" style="flex:${g.list.length - mix(g.list).reduce((a, m) => a + m.k, 0)}"></i>` : ""}</span></a>`).join("")}</div>`;
      if (App.reveal) App.reveal(ov.parentElement, ".cat-overview");
    }
  }
  const groupEl = document.getElementById("group-by");
  if (groupEl) {
    const mark = () => groupEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.g === groupBy)));
    mark();
    groupEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-g]"); if (!b || b.dataset.g === groupBy) return;
      groupBy = b.dataset.g; try { localStorage.setItem("groupBy", groupBy); } catch (err) { /* ignore */ }
      mark(); renderAll();
    });
  }
  const onlyEl = document.getElementById("starred-only");
  const searchEl = document.getElementById("search");
  function renderAll() { render(); filter(); }

  /* Search and "Starred only" hide cards, and any group left with none. */
  function filter() {
    const q = searchEl.value.trim().toLowerCase();
    const only = Boolean(onlyEl && onlyEl.checked);
    cardsEl.querySelectorAll(".card-wrap").forEach((el) => {
      el.hidden = (Boolean(q) && !el.dataset.search.includes(q)) || (only && !el.classList.contains("is-starred"));
    });
    cardsEl.querySelectorAll(".cat-group").forEach((g) => {
      g.hidden = (Boolean(q) || only) && !g.querySelector(".card-wrap:not([hidden])");
    });
    const none = document.getElementById("no-match");
    const any = cardsEl.querySelector(".card-wrap:not([hidden])");
    none.hidden = Boolean(any) || (!q && !only);
    none.textContent = only && !q ? "No starred companies yet. Tap ☆ on a company to star it."
      : only ? `No starred company's name contains "${searchEl.value.trim()}".`
      : `No company's name contains "${searchEl.value.trim()}".`;
  }

  renderAll();
  document.addEventListener("themechange", renderAll);
  if (App.Stars.enabled()) {
    App.Stars.wire(cardsEl);
    App.Stars.onChange(renderAll);
    App.Stars.load();
    onlyEl.closest("label").hidden = false;
    onlyEl.addEventListener("change", filter);
  }

  // Banner listing research published in the last few days that this viewer hasn't dismissed.
  const fresh = companies.filter((c) => App.isRecentResearch(c.latestResearch) && !App.isDismissed(App.researchKey(c.ticker, c.latestResearch)))
    .sort((a, b) => b.latestResearch.date.localeCompare(a.latestResearch.date));
  const noticeEl = document.getElementById("notice");
  if (fresh.length) {
    noticeEl.innerHTML = `<div class="notice" role="status"><div><h2>New research published</h2><ul>${fresh.map((c) =>
      `<li><a href="company.html?t=${encodeURIComponent(c.ticker)}">${App.esc(c.name)}</a>: ${App.researchLine(c.latestResearch)}</li>`).join("")}</ul></div>
      <button type="button" id="dismiss-notice">Dismiss</button></div>`;
    document.getElementById("dismiss-notice").addEventListener("click", () => {
      fresh.forEach((c) => App.dismiss(App.researchKey(c.ticker, c.latestResearch)));
      noticeEl.innerHTML = "";
    });
  }

  searchEl.addEventListener("input", filter);
})();
