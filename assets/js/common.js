/* Shared helpers: loading data, number formats, prices, results dates, theme, glossary. */
"use strict";

const App = {};

/* ---------- Loading ---------- */
App.load = async function (url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  return r.json();
};
App.loadOptional = async function (url, fallback) {
  try { return await App.load(url); } catch (e) { return fallback; }
};

/* ---------- Safe text ---------- */
App.esc = function (s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
};
/* Tiny, safe markdown: paragraphs, "- " bullets, **bold**. */
App.md = function (text) {
  if (!text) return "";
  const blocks = String(text).split(/\n\s*\n/);
  return blocks.map((b) => {
    const lines = b.split("\n");
    const inline = (l) => App.esc(l).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      return "<ul>" + lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("") + "</ul>";
    }
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
};

/* ---------- Numbers ---------- */
App.isNum = (v) => typeof v === "number" && isFinite(v);
App.num = function (v, maxDec = 2) {
  if (!App.isNum(v)) return "–";
  const dec = Number.isInteger(v) ? 0 : (Math.round(v * 10) === v * 10 ? 1 : maxDec);
  return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
/* Share prices: always two decimals, as the CSE quotes them. */
App.price = (v) => (App.isNum(v) ? "Rs " + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "–");
/* Per-share values from the analysis: as written (Rs 31, Rs 26.5). */
App.rs = (v) => (App.isNum(v) ? "Rs " + App.num(v) : "–");
/* Always two decimals, for per-share amounts such as dividends (Rs 1.50). */
App.rs2 = (v) => (App.isNum(v) ? "Rs " + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "–");
App.withUnit = function (v, unit) {
  if (!App.isNum(v)) return "n/m";
  switch (unit) {
    case "Rs": return App.rs(v);
    case "Rs bn": return "Rs " + App.num(v, 1) + "bn";
    case "Rs mn": return "Rs " + App.num(v, 0) + "mn";
    case "x": return App.num(v) + "x";
    case "%": return App.num(v, 1) + "%";
    default: return App.num(v);
  }
};
App.signedPct = (v) => (App.isNum(v) ? (v > 0 ? "+" : "") + v.toFixed(2) + "%" : "");

/* ---------- Dates ---------- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
App.parseDate = function (s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
App.date = function (s) {
  const d = typeof s === "string" ? App.parseDate(s) : s;
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "–";
};
App.today = function () {
  // Today's date in Sri Lanka (UTC+5:30).
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
App.daysBetween = (a, b) => Math.round((b - a) / 86400000);
const endOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)); // m is 0-based
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const addMonthsSameDay = (d, n) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = endOfMonth(t.getUTCFullYear(), t.getUTCMonth()).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d.getUTCDate(), last)));
};

/* CSE Listing Rule 7.4: quarterly results within 45 days of quarter-end for the
   first three quarters, and within two months of the end of the fourth quarter. */
App.resultsStatus = function (resultsCovered, fiscalYearEnd, today = App.today()) {
  const end = App.parseDate(resultsCovered && resultsCovered.periodEnd);
  if (!end) return null;
  const fye = /^(\d{2})-(\d{2})$/.exec(fiscalYearEnd || "12-31") || [null, "12", "31"];
  const fyMonth = +fye[1] - 1;
  const next = (d) => endOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 3);
  const deadline = (qEnd) => (qEnd.getUTCMonth() === fyMonth ? addMonthsSameDay(qEnd, 2) : addDays(qEnd, 45));
  const n1 = next(end), d1 = deadline(n1);
  const n2 = next(n1), d2 = deadline(n2);
  const label = (q) => (q.getUTCMonth() === fyMonth ? `full-year results (year to ${App.date(q)})` : `results for the quarter to ${App.date(q)}`);
  if (today > d2) return { level: "bad", text: `This analysis is based on results to ${App.date(end)}. At least two newer result periods have been published since. Consider re-running it.` };
  if (today > d1) return { level: "warn", text: `Newer ${label(n1)} were due by ${App.date(d1)}. This analysis may be out of date.` };
  return { level: "ok", text: `Next: ${label(n1)}, due by ${App.date(d1)}.` };
};

/* ---------- Prices ---------- */
/* Choose the price to show for one share class: the daily CSE close when it is
   newer than the analysis price, otherwise the analysis price. */
App.resolvePrice = function (symbol, analysisPrice, prices) {
  const p = prices && prices.symbols && prices.symbols[symbol];
  const aDate = App.parseDate(analysisPrice && analysisPrice.date);
  const today = App.today();
  if (p && App.isNum(p.close)) {
    const pDate = App.parseDate(p.priceDate);
    if (!aDate || (pDate && pDate >= aDate)) {
      const fetched = p.fetchedAt ? new Date(p.fetchedAt) : null;
      const feedAge = fetched ? Math.floor((Date.now() - fetched.getTime()) / 86400000) : null;
      const lastTrade = App.parseDate(p.lastTradeDate);
      return {
        value: p.close, change: p.change, changePct: p.changePct, date: p.priceDate, source: "cse",
        feedStale: feedAge !== null && feedAge > 4, feedAge,
        noTradeSince: lastTrade && pDate && App.daysBetween(lastTrade, pDate) >= 3 ? p.lastTradeDate : null,
      };
    }
  }
  if (analysisPrice && App.isNum(analysisPrice.value)) {
    return { value: analysisPrice.value, date: analysisPrice.date, source: "analysis",
      age: aDate ? App.daysBetween(aDate, today) : null };
  }
  return null;
};

/* Where the price sits against the analysis levels. */
App.priceStatus = function (price, v) {
  if (!price || !v || !App.isNum(v.fairValue)) return null;
  const p = price.value;
  const pct = ((p - v.fairValue) / v.fairValue) * 100;
  const rel = `${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? "above" : "below"} fair value`;
  if (App.isNum(v.strongBuyPrice) && p <= v.strongBuyPrice) return { key: "strong-buy", cls: "good", label: "Strong-buy zone", rel, pct };
  if (App.isNum(v.buyPrice) && p <= v.buyPrice) return { key: "buy", cls: "good", label: "Below buy price", rel, pct };
  if (p <= v.fairValue) return { key: "below-fair", cls: "warn", label: "Below fair value", rel, pct };
  return { key: "above-fair", cls: "bad", label: rel, rel, pct };
};

/* ---------- Categories ----------
   Two questions decide a company's category:
   1. Is the business good enough to own for years? (data file: quality.rating,
      "good" when it passes at least 3 of the 4 business tests)
   2. Is the price at or below the buy price? (latest price of any share class)
   Category 1 = good business at or below the buy price; 2 = good business,
   price still too high; 3 = the business fails the tests. */
App.CATEGORIES = {
  1: { n: 1, name: "Buy now", cls: "cat1", lead: "Good businesses priced at or below my buy price." },
  2: { n: 2, name: "Watch list", cls: "cat2", lead: "Good businesses, but the price is above my buy price. Wait for it to fall." },
  3: { n: 3, name: "Avoid for now", cls: "cat3", lead: "The business fails my tests: low returns, heavy debt, uneven profit or weak cash flow." },
};
App.category = function (quality, valuation, classPrices) {
  if (!quality || !quality.rating) return null;
  if (quality.rating !== "good") return App.CATEGORIES[3];
  const buy = valuation && valuation.buyPrice;
  const cheap = App.isNum(buy) && (classPrices || []).some((p) => p && App.isNum(p.value) && p.value <= buy);
  return App.CATEGORIES[cheap ? 1 : 2];
};

App.priceSourceText = function (pr) {
  if (!pr) return "No price available";
  if (pr.source === "cse") {
    let t = `CSE close, ${App.date(pr.date)}`;
    if (pr.feedStale) t += ` (price feed hasn't updated for ${pr.feedAge} days)`;
    if (pr.noTradeSince) t += `, no trade since ${App.date(pr.noTradeSince)}`;
    return t;
  }
  return `Analysis price from ${App.date(pr.date)} (no CSE price available yet)`;
};

/* ---------- Logo or initials ---------- */
App.logo = function (company, size = "") {
  const initials = (company.name || company.ticker || "?").replace(/\bPLC\b/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  if (company.logo) {
    return `<img class="logo ${size}" src="${App.esc(company.logo)}" alt="" onerror="this.outerHTML='<span class=&quot;logo initials ${size}&quot; aria-hidden=&quot;true&quot;>${App.esc(initials)}</span>'">`;
  }
  return `<span class="logo initials ${size}" aria-hidden="true">${App.esc(initials)}</span>`;
};

/* ---------- Theme ---------- */
App.initTheme = function () {
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) { /* storage unavailable */ }
  if (saved === "dark") document.documentElement.dataset.theme = "dark";
  const btn = document.querySelector(".theme-toggle");
  if (!btn) return;
  const label = () => (btn.innerHTML = document.documentElement.dataset.theme === "dark" ? '<span class="tt-ic" aria-hidden="true">☀️</span><span class="tt-t">Light mode</span>' : '<span class="tt-ic" aria-hidden="true">🌙</span><span class="tt-t">Dark mode</span>');
  label();
  btn.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) { /* ignore */ }
    label();
    document.dispatchEvent(new Event("themechange")); // charts redraw in the new colours
  });
};

/* ---------- Glossary (hover, focus or tap a dotted term) ---------- */
App.GLOSSARY = {
  NAV: "Net asset value per share: what the company owns minus what it owes, divided by the number of shares. It's the accounting (book) value.",
  "P/NAV": "Price divided by NAV per share. 1x means you pay book value; 4x means four times book value.",
  ROE: "Return on equity: yearly profit as a percentage of shareholders' equity. Higher means the company earns more on the money shareholders have in it.",
  "P/E": "Price divided by earnings per share: how many years of current profit you pay for. Lower is cheaper, if profits hold.",
  EPS: "Earnings per share: the company's profit divided by the number of shares.",
  DCF: "Discounted cash flow: adds up the cash the company is expected to produce in future, discounted back to today's value.",
  FCF: "Free cash flow: cash from operations left after paying for equipment, licences and leases.",
  "FCF yield": "Free cash flow as a percentage of the company's market value: the cash return the business produces for its price.",
  "Dividend yield": "Yearly dividend per share as a percentage of the share price.",
  "Payout ratio": "The share of profit paid out as dividends.",
  "Dividend model": "Values the share as the sum of all future dividends, discounted back to today.",
  "Residual income": "Values the share as book value plus the profit it earns above the return shareholders require.",
  "Cost of equity": "The yearly return an investor requires for owning the share, used to discount future cash flows. Higher means a lower value today.",
  "Margin of safety": "How far below fair value you buy, as a cushion in case the estimates are wrong.",
  "Fair value": "The analysis's best estimate of what one share is worth, weighting the bear, base and bull cases.",
  "Buy price": "Fair value minus the margin of safety: the most the analysis suggests paying.",
  "Strong-buy price": "Fair value minus a larger margin of safety: a clearly attractive price.",
  Bear: "A pessimistic case: weaker growth, lower margins or higher costs.",
  Base: "The most likely case.",
  Bull: "An optimistic case.",
  "Net debt": "Borrowings (here including leases) minus cash.",
  EBITDA: "Earnings before interest, tax, depreciation and amortisation: a rough measure of operating cash profit.",
  Capex: "Capital expenditure: money spent on equipment, networks and other long-term assets.",
  "Market cap": "Share price times the number of shares: what the market values the whole company at.",
  Sensitivity: "Shows how the value changes if a key assumption is a little higher or lower.",
  Weighted: "The method's bear, base and bull values combined using the scenario weights.",
};
/* Map common label words to glossary entries. */
App.termFor = function (label) {
  const l = String(label).toLowerCase();
  const map = [
    ["price to nav", "P/NAV"], ["nav", "NAV"], ["return on equity", "ROE"], ["roe", "ROE"], ["p/e", "P/E"], ["eps", "EPS"],
    ["fcf yield", "FCF yield"], ["free cash flow to equity dcf", "DCF"], ["dcf", "DCF"], ["free cash flow", "FCF"],
    ["dividend yield", "Dividend yield"], ["payout", "Payout ratio"], ["dividend model", "Dividend model"],
    ["residual income", "Residual income"], ["cost of equity", "Cost of equity"], ["net debt / ebitda", "EBITDA"],
    ["net debt", "Net debt"], ["market cap", "Market cap"], ["dividends", "Dividend yield"], ["debt", "Net debt"],
  ];
  for (const [k, v] of map) if (l.includes(k)) return v;
  return null;
};
App.term = function (text, key) {
  const k = key || App.termFor(text);
  if (!k || !App.GLOSSARY[k]) return App.esc(text);
  return `<span class="term" tabindex="0" data-term="${App.esc(k)}">${App.esc(text)}</span>`;
};
App.initGlossary = function () {
  let tip = null;
  const show = (el) => {
    hide();
    tip = document.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "tooltip");
    tip.textContent = App.GLOSSARY[el.dataset.term] || "";
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + "px";
    tip.style.top = (r.bottom + 8 + tip.offsetHeight > window.innerHeight ? r.top - tip.offsetHeight - 8 : r.bottom + 8) + "px";
  };
  const hide = () => { if (tip) { tip.remove(); tip = null; } };
  document.addEventListener("mouseover", (e) => { const t = e.target.closest(".term"); if (t) show(t); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest(".term")) hide(); });
  document.addEventListener("focusin", (e) => { const t = e.target.closest(".term"); if (t) show(t); });
  document.addEventListener("focusout", hide);
  document.addEventListener("click", (e) => { const t = e.target.closest(".term"); if (t) show(t); else hide(); });
  window.addEventListener("scroll", hide, { passive: true });
};

/* ---------- What each saved figure means (the ⓘ in "Saved figures by period") ----------
   "Printed": read from the report. "Worked out": calculated by scripts/derived.py with exactly this equation.
   "Ratio": a ratio saved in the record (often the company's own figure); the equation shows how it's defined. */
App.FIGURES = {
  revenue: ["Revenue", "Printed", "Total sales for the period (income statement)."],
  grossProfit: ["Gross profit", "Printed", "Revenue less the direct cost of the goods or services sold (income statement)."],
  grossMarginPct: ["Gross margin", "Ratio", "How much of each rupee of sales is left after direct costs.", "Gross profit ÷ Revenue × 100"],
  operatingProfit: ["Operating profit", "Printed", "Profit from the business itself, before interest and tax (income statement)."],
  profitBeforeTax: ["Profit before tax", "Printed", "Profit after interest, before tax (income statement)."],
  incomeTax: ["Income tax", "Printed", "Tax charged on the period's profit (income statement)."],
  netProfit: ["Net profit", "Printed", "Profit after tax for the whole group, minorities included (income statement)."],
  netProfitOwners: ["Profit, owners' share", "Printed", "The part of net profit that belongs to the company's own shareholders, after minorities (income statement)."],
  eps: ["EPS", "Printed", "Earnings per share: the owners' share of profit for each share (income statement).", "Profit, owners' share ÷ Weighted average number of shares"],
  dividendPerShare: ["Dividend per share", "Printed", "Dividend paid or declared on each share for the period."],
  financeCosts: ["Finance costs", "Printed", "Interest charged on borrowings and leases (income statement)."],
  fxGainLoss: ["Exchange gain (loss)", "Printed", "Gain or loss from currency movements (income statement)."],
  operatingCashFlow: ["Operating cash flow", "Printed", "Cash generated by the business (statement of cash flows). Many Sri Lankan companies take interest paid out of it."],
  interestPaid: ["Interest paid", "Printed", "Interest actually paid in cash, and which part of the cash flow statement it sits in (statement of cash flows)."],
  capexPaid: ["Capex paid", "Worked out", "Cash spent on long-term assets.", "Capex: plant and equipment + Capex: intangibles"],
  purchasePPE: ["Capex: plant and equipment", "Printed", "Cash paid for property, plant and equipment (statement of cash flows)."],
  purchaseIntangibles: ["Capex: intangibles", "Printed", "Cash paid for licences, software and other intangibles (statement of cash flows)."],
  capexBooked: ["Capex booked", "Printed", "Assets added in the period, paid or not yet paid (asset or segment notes)."],
  capexCommitted: ["Capex committed", "Printed", "Spending already contracted but not yet made (commitments note)."],
  contractedCapex: ["Contracted capex", "Printed", "Spending already contracted but not yet made (commitments note)."],
  depreciation: ["Depreciation", "Printed", "The year's wear on long-term assets, with impairment and amortisation where the report adds them."],
  depreciationAmortisation: ["Depreciation and amortisation", "Printed", "The period's wear on long-term assets and licences, with impairment where the report adds it."],
  leasePrincipal: ["Lease payments", "Printed", "The capital part of lease payments (statement of cash flows, financing)."],
  dividendsPaid: ["Dividends paid", "Printed", "Cash paid out as dividends (statement of cash flows)."],
  freeCashFlow: ["Free cash flow", "Worked out", "Cash left after keeping the business running and paying for leases.", "Operating cash flow − Capex paid − Lease payments"],
  ebitda: ["EBITDA", "Worked out", "A rough measure of the cash the operations earn.", "Operating profit + Depreciation and amortisation"],
  totalEquity: ["Owners' equity", "Printed", "What belongs to the company's shareholders on the balance sheet."],
  navPerShare: ["NAV per share", "Printed", "Net asset value for each share: the book value.", "Owners' equity ÷ Number of shares"],
  borrowings: ["Borrowings", "Printed", "Loans, debentures and overdrafts (balance sheet)."],
  leaseLiabilities: ["Lease liabilities", "Printed", "What's still owed on leases (balance sheet)."],
  cash: ["Cash", "Printed", "Cash and short-term deposits (balance sheet)."],
  netDebt: ["Net debt", "Worked out", "What the company owes, less the cash it holds.", "Borrowings + Lease liabilities − Cash"],
  nonControllingInterest: ["Minorities", "Printed", "The part of the group's equity that belongs to other owners of its subsidiaries (balance sheet)."],
  sharesOutstanding: ["Shares outstanding", "Printed", "Number of shares in issue."],
  roe: ["Return on equity", "Ratio", "Profit earned on each rupee of shareholders' equity. The figure here is as saved (often the company's own); the code's twelve-month ROE uses this equation.", "Profit, owners' share ÷ Average owners' equity × 100"],
  taxRate: ["Tax rate", "Worked out", "Share of profit before tax paid as tax.", "Income tax ÷ Profit before tax × 100"],
  peYearEnd: ["P/E at year-end", "Ratio", "Years of profit the share price paid for at the year-end.", "Share price at year-end ÷ EPS"],
  priceYearEnd: ["Share price at year-end", "Printed", "The closing share price on the last day of the year."],
  debtToEquity: ["Debt to equity", "Ratio", "Borrowing compared with shareholders' money.", "Borrowings ÷ Owners' equity"],
  netDebtToEbitda: ["Net debt / EBITDA", "Ratio", "Years of operating cash it would take to repay net debt.", "Net debt ÷ EBITDA"],
};
App.figInfo = function (key, label) {
  if (!App.FIGURES[key]) return App.esc(label);
  return `${App.esc(label)}<button type="button" class="fi" data-fig="${App.esc(key)}" aria-label="What is ${App.esc(label)}?">ⓘ</button>`;
};
App.initFigInfo = function () {
  let tip = null;
  const hide = () => { if (tip) { tip.remove(); tip = null; } };
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".fi");
    if (!b) { if (!e.target.closest(".tip.fig")) hide(); return; }
    e.stopPropagation(); hide();
    const [name, kind, what, eq] = App.FIGURES[b.dataset.fig];
    tip = document.createElement("div");
    tip.className = "tip fig"; tip.setAttribute("role", "tooltip");
    tip.innerHTML = `<b>${App.esc(name)}</b> <span class="kind ${kind === "Printed" ? "printed" : kind === "Ratio" ? "ratio" : "calc"}">${kind === "Printed" ? "From the report" : kind === "Ratio" ? "Ratio as saved" : "Worked out by code"}</span>
      <div>${App.esc(what)}</div>${eq ? `<div class="eq">${App.esc(name)} = ${App.esc(eq)}</div>` : ""}`;
    document.body.appendChild(tip);
    const r = b.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - 20)) + "px";
    tip.style.top = (r.bottom + 8 + tip.offsetHeight > window.innerHeight ? r.top - tip.offsetHeight - 8 : r.bottom + 8) + "px";
  }, true);
  window.addEventListener("scroll", hide, { passive: true });
};

/* ---------- New research notices ---------- */
App.NEW_RESEARCH_DAYS = 7;   // how long a "new research" notice shows
App.isRecentResearch = function (r) {
  const d = r && App.parseDate(r.date);
  return !!d && App.daysBetween(d, App.today()) <= App.NEW_RESEARCH_DAYS;
};
App.researchKey = (ticker, r) => `seen:${ticker}:${r.date}`;
App.isDismissed = function (key) {
  try { return localStorage.getItem(key) === "1"; } catch (e) { return false; }
};
App.dismiss = function (key) {
  try { localStorage.setItem(key, "1"); } catch (e) { /* storage unavailable: shows again next visit */ }
};
App.researchLine = function (r) {
  const fv = App.isNum(r.previousFairValue) && App.isNum(r.fairValue) && r.previousFairValue !== r.fairValue
    ? `fair value ${App.rs(r.previousFairValue)} → ${App.rs(r.fairValue)}`
    : App.isNum(r.fairValue) ? `fair value ${App.rs(r.fairValue)}` : "";
  return `${r.kind === "updated" ? "Updated" : "New research"} on ${App.date(r.date)}${r.basedOn ? `, based on ${App.esc(r.basedOn)}` : ""}${fv ? `: ${fv}` : ""}.`;
};

App.init = function () { App.initTheme(); App.initGlossary(); };

/* ---------- Stars ----------
   Starred companies are kept by the Cloudflare worker (listener/worker.js, GET/POST /stars),
   so they're the same on every device. There's no key: anyone who opens the site can star.
   Leave STARS_URL empty to hide the stars. The last list seen is kept in this browser so
   stars show at once; the worker's list replaces it when it arrives. */
App.STARS_URL = "https://cse-summary.sacdulanjayachathura.workers.dev";
App.Stars = {
  set: new Set(),
  listeners: [],
  enabled: () => Boolean(App.STARS_URL),
  has: (t) => App.Stars.set.has(t),
  onChange(fn) { this.listeners.push(fn); },
  emit() { this.listeners.forEach((fn) => fn(this.set)); },
  remember() { try { localStorage.setItem("stars", JSON.stringify([...this.set])); } catch (e) { /* storage off */ } },
  async load() {
    if (!this.enabled()) return this.set;
    try { this.set = new Set(JSON.parse(localStorage.getItem("stars") || "[]")); } catch (e) { /* storage off */ }
    this.emit();
    try {
      const r = await fetch(App.STARS_URL.replace(/\/$/, "") + "/stars", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      this.set = new Set((await r.json()).stars || []);
      this.remember();
      this.emit();
    } catch (e) { console.warn("Stars couldn't be loaded", e); }
    return this.set;
  },
  /* Changes the star at once, then saves it; puts it back if saving fails. */
  async toggle(ticker) {
    const starred = !this.set.has(ticker);
    starred ? this.set.add(ticker) : this.set.delete(ticker);
    this.emit();
    try {
      const r = await fetch(App.STARS_URL.replace(/\/$/, "") + "/stars", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker, starred }),
      });
      if (!r.ok) throw new Error(r.status);
      this.set = new Set((await r.json()).stars || []);
      this.remember();
      this.emit();
      return true;
    } catch (e) {
      starred ? this.set.delete(ticker) : this.set.add(ticker);
      this.emit();
      App.toast("Couldn't save the star. Check your connection and try again.");
      return false;
    }
  },
  button(ticker, name) {
    if (!this.enabled()) return "";
    const on = this.has(ticker);
    return `<button type="button" class="star${on ? " on" : ""}" data-star="${App.esc(ticker)}" aria-pressed="${on}"
      aria-label="${on ? "Unstar" : "Star"} ${App.esc(name || ticker)}" title="${on ? "Starred: tap to unstar" : "Star this company"}">${on ? "★" : "☆"}</button>`;
  },
  /* Keeps every star button inside `root` in step, and makes them work. */
  wire(root) {
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-star]");
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      this.toggle(b.dataset.star);
    });
    this.onChange(() => root.querySelectorAll("[data-star]").forEach((b) => {
      const on = this.has(b.dataset.star);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
      b.textContent = on ? "★" : "☆";
      b.title = on ? "Starred: tap to unstar" : "Star this company";
      b.setAttribute("aria-label", b.getAttribute("aria-label").replace(/^(Unstar|Star)/, on ? "Unstar" : "Star"));
    }));
  },
};

/* A short message at the bottom of the screen. */
App.toast = function (text) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(App.toast.t);
  App.toast.t = setTimeout(() => el.classList.remove("show"), 4000);
};

/* ---------- Keeping chart labels apart ----------
   All in SVG units. Text width is estimated from its length and font size. */
App.textW = (text, size = 12) => String(text).length * size * 0.62;

/* Labels on one line (axis labels, value labels): keep the most important ones and drop any
   that would overlap a label already kept. items: [{x, w, prio, anchor}] (x = centre unless
   anchor "start"/"end"). Returns the set of indexes to draw. */
App.fitLabels = function (items, gap = 4) {
  const span = (it) => it.anchor === "start" ? [it.x, it.x + it.w] : it.anchor === "end" ? [it.x - it.w, it.x] : [it.x - it.w / 2, it.x + it.w / 2];
  const order = items.map((_, i) => i).sort((a, b) => (items[b].prio || 0) - (items[a].prio || 0) || a - b);
  const kept = [], show = new Set();
  for (const i of order) {
    const [a, b] = span(items[i]);
    if (kept.every(([c, d]) => b + gap <= c || a >= d + gap)) { kept.push([a, b]); show.add(i); }
  }
  return show;
};

/* Labels that must all show (price levels): give each a row so labels in the same row don't
   overlap. Returns the row number for each item (0 = first row). */
App.stackLabels = function (items, gap = 6) {
  const rowsEnd = [], out = new Array(items.length);
  items.map((it, i) => [it, i]).sort((p, q) => p[0].x - q[0].x).forEach(([it, i]) => {
    const a = it.x - it.w / 2;
    let r = rowsEnd.findIndex((end) => a >= end + gap);
    if (r < 0) { r = rowsEnd.length; rowsEnd.push(0); }
    rowsEnd[r] = it.x + it.w / 2; out[i] = r;
  });
  return out;
};

/* Labels next to points (scatter, line values): try each candidate box in turn and use the
   first that doesn't hit a label already placed, a point, or the chart edge. cands: per label
   a list of {x, y, w, h} boxes (x, y = top-left). Returns the chosen box index per label, or -1. */
App.placeBoxes = function (cands, { avoid = [], W = Infinity, H = Infinity } = {}) {
  const placed = avoid.slice();
  const hit = (b) => b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H ||
    placed.some((p) => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y);
  return cands.map((list) => {
    const k = list.findIndex((b) => !hit(b));
    if (k >= 0) placed.push(list[k]);
    return k;
  });
};

/* Labels that must stay on one line: slide them sideways just enough that none overlap,
   keeping each as close to its own point as possible and inside 0..W. Returns the new centres,
   or null if they can't all fit on one line. items: [{x, w}] (x = centre). */
App.dodge = function (items, W, gap = 8) {
  const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x);
  const total = items.reduce((a, it) => a + it.w + gap, -gap);
  if (total > W) return null;
  const pos = new Array(items.length);
  let prevEnd = -Infinity;
  order.forEach((i) => { const it = items[i]; let c = Math.max(it.x, it.w / 2, prevEnd + gap + it.w / 2); pos[i] = c; prevEnd = c + it.w / 2; });
  let nextStart = Infinity;
  order.slice().reverse().forEach((i) => { const it = items[i]; let c = Math.min(pos[i], W - it.w / 2, nextStart - gap - it.w / 2); pos[i] = c; nextStart = c - it.w / 2; });
  return pos;
};

/* ---------- Animations ----------
   Cards fade up as they scroll into view; bars grow, lines draw and rings fill inside them
   (style.css, "Animations"). Children of a grid come in one after another. Nothing moves for
   anyone whose device asks for reduced motion. */
App.reveal = function (root, selector) {
  if (!root || !("IntersectionObserver" in window)) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const els = [...root.querySelectorAll(selector)];
  if (reduce) { els.forEach((el) => el.classList.add("in")); return; }
  const STAGGER = ".rs-tiles > .rs-sec, .news-grid > .news2, .stat-grid > .stat, .divc-grid > .divc, .alert-cards > .alert-card, .call-list .call1, .tiles > .tile, .hl2 > .hl2-row, .flow, .rs-glance li, .figures > .figure, .tests > .test, .hcards > .hcard, .tiers > .tier, .cmv2 li, .vstrip > *, .st2 > .status, .tscore i, .mtiles > .mtile, .cases > .case";
  const obs = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target;
    el.querySelectorAll(STAGGER).forEach((c, i) => c.style.setProperty("--i", Math.min(i, 14)));
    el.classList.add("reveal", "in");
    obs.unobserve(el);
  }), { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  els.forEach((el) => { el.classList.add("reveal"); obs.observe(el); });
};
