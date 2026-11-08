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
  const companies = (index.companies || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  updatedEl.textContent = prices.updatedAt
    ? `${companies.length} ${companies.length === 1 ? "company" : "companies"}. Prices last updated ${App.date(prices.updatedAt.slice(0, 10))}.`
    : `${companies.length} ${companies.length === 1 ? "company" : "companies"}`;

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
    if (App.isRecentResearch(c.latestResearch)) badges.push(`<span class="badge new">${c.latestResearch.kind === "updated" ? "Updated" : "New research"} ${App.date(c.latestResearch.date)}</span>`);
    if (st) badges.push(`<span class="badge ${st.cls}">${App.esc(st.label)}</span>`);
    const rs = App.resultsStatus(c.resultsCovered, c.fiscalYearEnd);
    if (rs && rs.level !== "ok") badges.push(`<span class="badge ${rs.level}">Analysis may be out of date</span>`);
    if (main && main.source === "analysis") badges.push(`<span class="badge muted">Price from analysis</span>`);
    if (main && main.feedStale) badges.push(`<span class="badge warn">Price not updated recently</span>`);
    if (main && main.noTradeSince) badges.push(`<span class="badge muted">No trade since ${App.date(main.noTradeSince)}</span>`);

    return `<a class="card" href="company.html?t=${encodeURIComponent(c.ticker)}" data-search="${App.esc((c.name + " " + c.ticker + " " + c.shareClasses.map((s) => s.symbol).join(" ")).toLowerCase())}">
      <div class="card-top">${App.logo(c)}<div><div class="card-name">${App.esc(c.name)}</div><div class="card-sector">${App.esc(c.sector || "")}</div></div></div>
      <div class="prices">${lines.map((l) => l.html).join("")}</div>
      ${main ? Charts.mini({ price: main.value, strongBuy: v.strongBuyPrice, buy: v.buyPrice, fair: v.fairValue }) : ""}
      <div class="card-levels"><span>Buy <b>${App.rs(v.buyPrice)}</b></span><span>Fair value <b>${App.rs(v.fairValue)}</b></span><span>Analysis ${App.date(c.analysisDate)}</span></div>
      <div class="badges">${badges.join("")}</div>
    </a>`;
  }

  function render() {
    cardsEl.innerHTML = companies.length
      ? companies.map(card).join("")
      : `<div class="empty">No companies yet. Add an analysis file to the <b>data</b> folder in GitHub and it will appear here about a minute later.</div>`;
  }
  render();
  document.addEventListener("themechange", render);

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

  document.getElementById("search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    cardsEl.querySelectorAll(".card").forEach((el) => { el.hidden = q && !el.dataset.search.includes(q); });
  });
})();
