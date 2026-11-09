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
  const label = () => (btn.textContent = document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode");
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
