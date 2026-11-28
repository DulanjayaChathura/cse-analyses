/* Portfolio page.
   The owner's portfolio is kept encrypted (data/portfolio.enc.json, AES-256-GCM with a key made from
   the passphrase by PBKDF2-SHA256, the same format as scripts/portfolio_store.py) and unlocked here,
   in the browser, with the passphrase; nothing leaves the device. Without that file, or on request,
   the page shows an example portfolio with dummy trades. Real money only: no fair values here. */
(async function () {
  const root = document.getElementById("pf"), sub = document.getElementById("pf-sub");
  const FEE = 0.0112;   // CSE transaction cost up to Rs 100mn: brokerage 0.64% + CSE, CDS, SEC fees + 0.30% levy
  const DIV_TAX = 0.15; // dividend tax withheld (to confirm against real dividend slips)
  const TODAY = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // Sri Lanka date

  // Example: dummy trades and dividends, only to show what the page looks like.
  const EXAMPLE_TRADES = [
    ["2026-01-14", "SAMP.N0000", "buy", 200, 112.0], ["2026-03-17", "SAMP.N0000", "buy", 100, 131.5],
    ["2026-02-03", "COMB.N0000", "buy", 400, 112.0], ["2026-04-02", "HNB.N0000", "buy", 100, 330.0],
    ["2026-05-04", "DIAL.N0000", "buy", 600, 38.2], ["2026-10-14", "DIAL.N0000", "sell", 100, 46.0],
    ["2026-06-02", "JKH.N0000", "buy", 1000, 19.8], ["2026-07-01", "CCS.N0000", "buy", 60, 92.0],
    ["2026-08-03", "LOLC.N0000", "buy", 50, 520.0], ["2026-09-15", "TKYO.N0000", "buy", 200, 70.0],
  ].map(([d, code, side, n, p]) => ({ d, code, side, n, p, fees: Math.round(n * p * FEE * 100) / 100 }));
  const EXAMPLE_DIVS = [
    ["SAMP.N0000", 10.3, "2026-03-20", "2026-04-02"], ["COMB.N0000", 6.5, "2026-04-08", "2026-04-16"],
    ["HNB.N0000", 15.0, "2026-06-05", "2026-06-15"], ["DIAL.N0000", 1.5, "2026-08-06", "2026-08-14"],
    ["DIAL.N0000", 0.7, "2026-11-10", "2026-11-16"], ["DIAL.N0000", 0.7, "2026-12-11", "2026-12-23"],
    ["SAMP.N0000", 10.3, "2027-03-20", "2027-04-02", true], ["COMB.N0000", 6.5, "2027-03-27", "2027-04-10", true],
  ].map(([code, dps, xd, pay, est]) => ({ code, dps, xd, pay, est: !!est }));

  let index, prices, aspi, bond, sealed, yearEnd;
  try {
    [index, prices, aspi, bond, sealed, yearEnd] = await Promise.all([App.load("data/index.json"), App.loadOptional("data/prices.json", {}),
      App.loadOptional("data/aspi.json", {}), App.loadOptional("data/bond.json", {}), App.loadOptional("data/portfolio.enc.json", null), App.loadOptional("data/year-end.json", {})]);
  } catch (e) { root.innerHTML = `<p class="error">The data couldn't be loaded.</p>`; return; }
  const byCode = new Map(index.companies.map((c) => [c.ticker, c]));

  /* ---- unlocking: same format as scripts/portfolio_store.py ---- */
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function unlock(pass) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(sealed.salt), iterations: sealed.rounds || 310000 },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  const fromStore = (data) => ({
    example: false,
    trades: (data.trades || []).map((t) => ({ d: t.d, code: t.code, side: t.side, n: t.n, p: t.p, fees: t.fees })),
    divs: Object.entries(data.dividends || {}).flatMap(([code, rows]) => rows.map((r) => ({ code, dps: r.dps, xd: r.xd, pay: r.pay || r.xd, note: r.note })))
      .concat((data.manual || []).map((m) => ({ code: m.code, dps: m.dps, xd: m.xd, pay: m.pay || m.xd, note: "entered by hand" }))),
    updated: data.updated,
  });
  const EXAMPLE = { example: true, trades: EXAMPLE_TRADES, divs: EXAMPLE_DIVS };

  function lockScreen(msg) {
    sub.textContent = "Locked · your portfolio is encrypted";
    root.innerHTML = `<form class="pf-lock" autocomplete="off"><div class="pf-lock-ic" aria-hidden="true">🔒</div>
      <h2>Unlock your portfolio</h2><p>Type your passphrase. It unlocks the portfolio here in your browser; nothing is sent anywhere.</p>
      <input type="password" class="pf-pass" placeholder="Passphrase" aria-label="Passphrase" required>
      <label class="pf-remember"><input type="checkbox" class="pf-rem"> Remember on this device</label>
      ${msg ? `<p class="pf-lock-err">${msg}</p>` : ""}
      <button type="submit" class="pf-go">Unlock</button>
      <button type="button" class="pf-demo-btn">Show the example instead</button></form>`;
    const f = root.querySelector("form");
    f.querySelector(".pf-pass").focus();
    f.querySelector(".pf-demo-btn").addEventListener("click", () => render(EXAMPLE));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = f.querySelector(".pf-pass").value, rem = f.querySelector(".pf-rem").checked;
      f.querySelector(".pf-go").textContent = "Unlocking…";
      try {
        const data = await unlock(pass);
        try { if (rem) localStorage.setItem("pfPass", pass); else localStorage.removeItem("pfPass"); } catch (err) { /* storage off */ }
        render(fromStore(data));
      } catch (err) { lockScreen("That passphrase doesn't unlock it. Try again."); }
    });
  }

  if (sealed && new URLSearchParams(location.search).get("example") === null) {
    let saved = null; try { saved = localStorage.getItem("pfPass"); } catch (e) { /* storage off */ }
    if (saved) { try { render(fromStore(await unlock(saved))); } catch (e) { lockScreen("The saved passphrase no longer works."); } }
    else lockScreen();
  } else render(EXAMPLE);

  function render(model) {
  const TRADES = model.trades;
  // fixed decimals everywhere on this page (App.num keeps a value's own single decimal)
  const N = (x, d = 0) => (App.isNum(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const rs = (x, d = 0) => `Rs ${N(x, d)}`;
  const big = (x) => Math.abs(x) >= 1e6 ? `Rs ${N(x / 1e6, 2)}mn` : `Rs ${Math.round(x).toLocaleString("en-US")}`;
  const sgn = (x, d = 1) => `${x >= 0 ? "+" : "−"}${N(Math.abs(x), d)}`;
  if (!TRADES.length) {
    sub.textContent = "Your portfolio · nothing recorded yet";
    root.innerHTML = `<div class="pf-demo"><span aria-hidden="true">💼</span><div><b>Nothing recorded yet.</b> Post <code>/buy COCR 200 95.20</code> in your Telegram channel to add your first purchase.</div></div>`;
    return;
  }

  // shares held at the close of the trading day before `day` (who gets a dividend: held before the XD date)
  const heldBefore = (code, day) => TRADES.filter((t) => t.code === code && t.d < day).reduce((a, t) => a + (t.side === "buy" ? t.n : -t.n), 0);
  const events = model.divs.map((v) => ({ ...v, shares: Math.max(0, heldBefore(v.code, v.xd)) }));
  const DIVS = events.filter((v) => v.shares > 0 && v.pay <= TODAY).map((v) => ({ ...v, d: v.pay }));
  const heldNow = (code) => heldBefore(code, "9999-12-31");
  const UPCOMING = events.filter((v) => v.pay > TODAY).map((v) => ({ ...v, ex: v.xd, sharesFor: v.xd > TODAY ? heldNow(v.code) : v.shares }))
    .filter((v) => v.sharesFor > 0).sort((a, b) => a.pay.localeCompare(b.pay));

  const pos = new Map();
  TRADES.slice().sort((a, b) => a.d.localeCompare(b.d)).forEach((t) => {
    const h = pos.get(t.code) || { code: t.code, shares: 0, costTotal: 0, realised: 0, divs: 0, first: t.d };
    if (t.side === "buy") { h.costTotal += t.n * t.p + t.fees; h.shares += t.n; }
    else { const avg = h.costTotal / h.shares, out = t.n * t.p - t.fees; h.realised += out - avg * t.n; h.costTotal -= avg * t.n; h.shares -= t.n; }
    pos.set(t.code, h);
  });
  DIVS.forEach((v) => { const h = pos.get(v.code); if (h) h.divs += v.shares * v.dps * (1 - DIV_TAX); });
  const HELD = [...pos.values()].filter((h) => h.shares > 0).map((h) => ({ ...h, avg: h.costTotal / h.shares }));

  const rows = HELD.map((h) => {
    const c = byCode.get(h.code); if (!c) return null;
    const pr = App.resolvePrice(h.code, c.price, prices); if (!pr || !App.isNum(pr.value)) return null;
    const v = c.valuation || {}, cat = App.category(c.quality, v, [pr]);
    const value = h.shares * pr.value, cost = h.costTotal;
    const prev = App.isNum(pr.change) ? pr.value - pr.change : null;
    // dividends a year: everything the company paid per share over the last 12 months (by XD date),
    // from the CSE's announcements; if there are none on record, the latest dividend in its analysis
    const yearAgo = new Date(Date.parse(TODAY) - 365 * 864e5).toISOString().slice(0, 10);
    const last12 = model.divs.filter((v) => v.code === h.code && !v.est && v.xd > yearAgo && v.xd <= TODAY).reduce((a, v) => a + v.dps, 0);
    const dps = last12 > 0 ? last12 : (c.dividend && App.isNum(c.dividend.perShare) ? c.dividend.perShare : null);
    return { h, c, pr, v, cat, value, cost, pl: value - cost, plPct: (value / cost - 1) * 100,
      today: prev !== null ? h.shares * pr.change : 0,
      div: dps !== null ? h.shares * dps * (1 - DIV_TAX) : null, sector: App.sectorOf(c), got: h.divs, realised: h.realised,
      total: value - cost + h.divs + h.realised, totalPct: (value - cost + h.divs + h.realised) / cost * 100 };
  }).filter(Boolean).sort((a, b) => b.value - a.value);

  const T = rows.reduce((t, r) => ({ value: t.value + r.value, cost: t.cost + r.cost, today: t.today + r.today,
    div: t.div + (r.div || 0) }), { value: 0, cost: 0, today: 0, div: 0 });
  const pl = T.value - T.cost, plPct = (T.value / T.cost - 1) * 100, todayPct = T.today / (T.value - T.today) * 100;
  const latest = rows.map((r) => r.pr.date).filter(Boolean).sort().pop();
  const today = latest || new Date().toISOString().slice(0, 10);

  // ---- total return: price gain + dividends received (after tax) + gains already taken on sales ----
  const got = [...pos.values()].reduce((a, h) => a + h.divs, 0), realised = [...pos.values()].reduce((a, h) => a + h.realised, 0);
  const priceGain = T.value - T.cost, total = priceGain + got + realised;
  const invested = TRADES.filter((t) => t.side === "buy").reduce((a, t) => a + t.n * t.p + t.fees, 0);
  const cash = (t) => (t.side === "buy" ? t.n * t.p + t.fees : t.n * t.p - t.fees); // money out on a buy, in on a sale

  // ---- money-weighted return per year (IRR): every buy, sale and dividend on its date, today's value at the end ----
  const flows = TRADES.map((t) => ({ d: t.d, v: t.side === "buy" ? -cash(t) : cash(t) }));
  DIVS.forEach((x) => flows.push({ d: x.d, v: x.shares * x.dps * (1 - DIV_TAX) }));
  const years = (d) => (Date.parse(today) - Date.parse(d)) / (365.25 * 864e5);
  const irr = (fl, end) => { const f = (r) => fl.reduce((a, x) => a + x.v * Math.pow(1 + r, years(x.d)), 0) - end;
    let lo = -0.99, hi = 10; if (f(lo) * f(hi) > 0) return null;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) * f(lo) > 0) lo = mid; else hi = mid; } return (lo + hi) / 2 * 100; };
  // flows are cash out (−) and in (+); value at today = Σ (−flow) grown at r, so solve Σ(−v)(1+r)^t = end value
  const myIrr = irr(flows.map((x) => ({ d: x.d, v: -x.v })), T.value);

  // ---- the same money in the ASPI: each buy buys index "units", each sale sells them, on the same days ----
  const ap = (aspi.points || []);
  const aspiAt = (d) => { let v = null; for (const [k, x] of ap) { if (k <= d) v = x; else break; } return v; };
  let units = 0, aspiOk = ap.length > 0;
  TRADES.forEach((t) => { const a = aspiAt(t.d); if (!a) { aspiOk = false; return; } units += (t.side === "buy" ? 1 : -1) * cash(t) / a; });
  const aspiNow = ap.length ? ap[ap.length - 1][1] : null, aspiValue = aspiOk && aspiNow ? units * aspiNow : null;
  const aspiIrr = aspiValue ? irr(TRADES.map((t) => ({ d: t.d, v: t.side === "buy" ? cash(t) : -cash(t) })), aspiValue) : null;
  // ---- the same money at the 10-year bond rate: each buy earns the rate from its day, each sale stops it ----
  const bondRate = App.isNum(bond && bond.value) ? bond.value : null;
  const bondValue = bondRate !== null ? TRADES.reduce((a, t) => a + (t.side === "buy" ? 1 : -1) * cash(t) * Math.pow(1 + bondRate / 100, years(t.d)), 0) : null;
  const mine = T.value + got + realised; // what you have to show for it (dividends and sales proceeds counted in)

  // ---- calendar years: every year is measured from 1 January (or from the first buy that year) ----
  // return = (value at the end − value on 1 January − money put in + money taken out + dividends) ÷ (value on 1 January + money put in)
  const curY = +TODAY.slice(0, 4), firstY = +TRADES.map((t) => t.d).sort()[0].slice(0, 4);
  const sharesAt = (code, day) => TRADES.filter((t) => t.code === code && t.d <= day).reduce((a, t) => a + (t.side === "buy" ? t.n : -t.n), 0);
  const codes = [...new Set(TRADES.map((t) => t.code))];
  const priceAtYearEnd = (code, y) => { const r = ((yearEnd.years || {})[String(y)] || {})[code]; return r ? r[1] : null; };
  const valueAt = (y) => { // value at the end of year y (today for the running year); null if a year-end price is missing
    if (y === curY) return T.value;
    let v = 0; for (const code of codes) { const n = sharesAt(code, `${y}-12-31`); if (!n) continue; const p = priceAtYearEnd(code, y); if (p === null) return null; v += n * p; } return v; };
  const aspiAtYearStart = (y) => aspiAt(`${y - 1}-12-31`), aspiEnd = (y) => (y === curY ? aspiNow : aspiAt(`${y}-12-31`));
  const YEARS = [];
  for (let y = firstY; y <= curY; y++) {
    const start = y === firstY ? 0 : valueAt(y - 1), end = valueAt(y), inYear = (d) => d.slice(0, 4) === String(y);
    const put = TRADES.filter((t) => t.side === "buy" && inYear(t.d)).reduce((a, t) => a + cash(t), 0);
    const out = TRADES.filter((t) => t.side === "sell" && inYear(t.d)).reduce((a, t) => a + cash(t), 0);
    const dv = DIVS.filter((x) => inYear(x.d)).reduce((a, x) => a + x.shares * x.dps * (1 - DIV_TAX), 0);
    const gain = start === null || end === null ? null : end - start - put + out + dv;
    const base = start === null ? null : start + put;
    const a0 = aspiAtYearStart(y), a1 = aspiEnd(y);
    const elapsed = y === curY ? (Date.parse(TODAY) - Date.parse(`${y}-01-01`)) / (365 * 864e5) : 1;
    YEARS.push({ y, start, end, put, out, dv, gain, pct: gain !== null && base ? gain / base * 100 : null,
      aspi: a0 && a1 ? (a1 / a0 - 1) * 100 : null, bond: bondRate !== null ? bondRate * elapsed : null });
  }
  const THIS = YEARS[YEARS.length - 1];

  // ---- concentration ----
  const warn = [];
  rows.forEach((r) => { const w = r.value / T.value * 100; if (w > 25) warn.push(`${App.esc(r.c.name.replace(/\s+PLC$/, ""))} is ${N(w)}% of the portfolio (more than 25% in one share).`); });
  sub.textContent = `${model.example ? "Example portfolio" : "Your portfolio"} · ${rows.length} holdings · since ${App.date(TRADES.map((t) => t.d).sort()[0])} · prices ${latest ? `as of ${App.date(latest)}` : "latest"}`;

  // ---- sector mix as a donut ----
  const mix = new Map();
  rows.forEach((r) => { const k = r.sector[0]; const m = mix.get(k) || { name: k, ic: r.sector[1], value: 0 }; m.value += r.value; mix.set(k, m); });
  const parts = [...mix.values()].sort((a, b) => b.value - a.value);
  const COLS = ["#0f766e", "#2563eb", "#c98400", "#9333ea", "#dc2626", "#0891b2", "#65a30d", "#db2777", "#475569"];
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  const donut = `<svg class="pf-donut" viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--rule)" stroke-width="18"/>${
    parts.map((p, i) => { const f = p.value / T.value, seg = `<circle class="pf-seg" style="--i:${i}" cx="70" cy="70" r="${R}" fill="none" stroke="${COLS[i % COLS.length]}" stroke-width="18"
      stroke-dasharray="${(f * C - 1.5).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-acc * C).toFixed(1)}" transform="rotate(-90 70 70)"/>`; acc += f; return seg; }).join("")}
    <text x="70" y="66" text-anchor="middle" font-size="11" fill="var(--ink-soft)">${parts.length} sectors</text>
    <text x="70" y="84" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">${big(T.value).replace("Rs ", "")}</text></svg>`;
  parts.forEach((p) => { const w = p.value / T.value * 100; if (w > 40) warn.push(`${p.ic} ${App.esc(p.name)} is ${N(w)}% of the portfolio (more than 40% in one sector).`); });
  const legend = parts.map((p, i) => `<li><i style="background:${COLS[i % COLS.length]}"></i><span>${p.ic} ${App.esc(p.name)}</span><b>${N(p.value / T.value * 100, 0)}%</b></li>`).join("");

  // ---- holdings by category ----
  const bySector = parts.map((p) => ({ p, list: rows.filter((r) => r.sector[0] === p.name) }));

  const tile = (ic, label, val, note, cls = "") => `<div class="pf-tile ${cls}"><span class="pf-t-ic" aria-hidden="true">${ic}</span><small>${label}</small><b>${val}</b>${note ? `<em>${note}</em>` : ""}</div>`;

  const card = (r) => {
    const w = r.value / T.value * 100;
    const more = r.h.shares < 500 ? `${N(500 - r.h.shares, 0)} more to reach 500` : "500-share plan complete";
    return `<a class="pf-card" style="--fc:${r.total >= 0 ? "var(--good)" : "var(--bad)"}" href="company.html?t=${encodeURIComponent(r.c.ticker)}">
      ${r.c.logo ? `<img class="card-wm" src="${App.esc(r.c.logo)}" alt="" aria-hidden="true">` : ""}
      <div class="pf-c-top">${App.logo(r.c, "sm")}<div class="pf-c-name"><b>${App.esc(r.c.name.replace(/\s+PLC$/, ""))}</b><small>${App.esc(r.c.ticker)} · ${r.sector[1]} ${App.esc(r.sector[0])}</small></div>
</div>
      <div class="pf-c-nums">
        <div><small>Holding</small><b>${N(r.h.shares, 0)} × ${rs(r.h.avg, 2)}</b><em>average incl. fees</em></div>
        <div><small>Value today</small><b>${big(r.value)}</b><em>${rs(r.pr.value, 2)}${App.isNum(r.pr.changePct) && r.pr.changePct ? ` <span class="${r.pr.changePct > 0 ? "up" : "down"}">${sgn(r.pr.changePct, 2)}%</span>` : ""}</em></div>
        <div class="pf-pl ${r.total >= 0 ? "up" : "down"}"><small>Total return</small><b>${r.total >= 0 ? "▲" : "▼"} ${big(Math.abs(r.total))}</b><em>${sgn(r.totalPct)}%</em></div>
      </div>
      <div class="pf-c-foot">
        ${r.got ? `<span class="pf-chip">💰 ${big(r.got)} received</span>` : ""}
        ${r.realised ? `<span class="pf-chip">🔁 ${r.realised >= 0 ? "+" : "−"}${big(Math.abs(r.realised))} taken on sales</span>` : ""}
        ${r.div ? `<span class="pf-chip">📅 ${big(r.div)} a year after tax</span>` : ""}
        <span class="pf-chip">🛒 ${more}</span>
        <span class="pf-w" title="Share of the portfolio"><i style="width:${w.toFixed(1)}%"></i><em>${N(w, 0)}% of portfolio</em></span>
      </div></a>`;
  };

  root.innerHTML = `
    ${model.example ? `<div class="pf-demo"><span aria-hidden="true">🧪</span><div><b>Example portfolio.</b> The companies and prices are real (CSE closes);
      the trades, dates and dividends received are dummy data, to show how your own portfolio will look. ${sealed ? ` <a href="portfolio.html">Unlock yours</a>.` : " Add yours with <code>/buy</code> in your Telegram channel."}</div></div>` : ""}

    <div class="pf-tiles">
      ${tile("💼", "Value today", big(T.value), `cost ${big(T.cost)} incl. fees`)}
      ${tile(total >= 0 ? "📈" : "📉", "Total return", `${total >= 0 ? "+" : "−"}${big(Math.abs(total))}`, `${sgn(total / invested * 100)}% on money put in`, total >= 0 ? "up" : "down")}
      ${tile("🏁", `This year (${THIS.y})`, THIS.pct !== null ? `${sgn(THIS.pct)}%` : "–",
        [THIS.aspi !== null ? `ASPI ${sgn(THIS.aspi)}%` : "", THIS.bond !== null ? `bond ${sgn(THIS.bond)}%` : ""].filter(Boolean).join(" · ") + " since 1 Jan",
        THIS.pct !== null ? (THIS.pct >= 0 ? "up" : "down") : "")}
      ${tile("🕐", "Today", `${T.today >= 0 ? "+" : "−"}${big(Math.abs(T.today))}`, `${sgn(todayPct, 2)}%`, T.today >= 0 ? "up" : "down")}
      ${(() => { const got = THIS.dv, toCome = UPCOMING.filter((u) => u.pay.slice(0, 4) === String(THIS.y)).reduce((a, u) => a + u.sharesFor * u.dps * (1 - DIV_TAX), 0);
        return tile("💰", `Dividends ${THIS.y}`, big(got + toCome), `${big(got)} received${toCome ? ` + ${big(toCome)} announced` : ""} · after ${N(DIV_TAX * 100)}% tax`); })()}
    </div>

    <div class="pf-row">
      <section class="pf-box"><h2>🧮 Where the return came from</h2>
        ${(() => { const segs = [["Price gain", priceGain, "#0f766e"], ["Dividends received", got, "#c98400"], ["Gains taken on sales", realised, "#2563eb"]];
          const pos2 = segs.filter((x) => x[1] > 0), sum = pos2.reduce((a, x) => a + x[1], 0) || 1;
          return `<div class="pf-stack">${pos2.map(([k, v, c]) => `<i style="flex:${(v / sum).toFixed(3)};background:${c}" title="${k}"></i>`).join("")}</div>
            <ul class="pf-legend">${segs.map(([k, v, c]) => `<li><i style="background:${c}"></i><span>${k}</span><b class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : "−"}${big(Math.abs(v))}</b></li>`).join("")}
            <li class="pf-tot"><i></i><span>Total return</span><b>${total >= 0 ? "+" : "−"}${big(Math.abs(total))}</b></li></ul>
            <p class="pf-note">Costs include the CSE's 1.12% on every buy and sale; dividends are after ${N(DIV_TAX * 100)}% tax.</p>`; })()}
      </section>
      <section class="pf-box"><h2>🏁 You against the alternatives</h2>
        ${(() => { const alts = [["💼", "You", mine, "me"]];
          if (bondValue) alts.push(["🏛️", `Bond ${N(bondRate, 2)}%`, bondValue, "bd"]);
          if (aspiValue) alts.push(["📊", "ASPI", aspiValue, "mk"]);
          const mx = Math.max(...alts.map((x) => x[2]));
          const verdict = (v, what) => `<li class="${mine >= v ? "up" : "down"}">${mine >= v ? "Ahead of" : "Behind"} ${what} by <b>${big(Math.abs(mine - v))}</b></li>`;
          return `<p class="pf-lead">The same money, put in on the same days and taken out when you sold:</p>
          <div class="pf-vsm">${alts.map(([ic, k, v, c]) => `<div><span>${ic} ${k}</span><span class="pf-vsm-bar"><i class="${c}" style="width:${(v / mx * 100).toFixed(1)}%"></i></span><b>${big(v)}</b></div>`).join("")}</div>
          <ul class="pf-verdicts">${bondValue ? verdict(bondValue, "the bond") : ""}${aspiValue ? verdict(aspiValue, "the market (ASPI)") : ""}</ul>
          <p class="pf-note">The bond is what you could really have done instead: the 10-year government bond rate (${bondRate !== null ? `${N(bondRate, 2)}%, ${App.date(bond.date)}` : "–"}) applied from each buy's date. The ASPI is a yardstick you can't buy directly; it's a price index, so it leaves out the market's dividends.</p>`; })()}
      </section>
    </div>

    <section class="pf-box pf-years"><h2>📆 Year by year <small>each year from 1 January</small></h2>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Year</th><th class="num">Value 1 Jan</th><th class="num">Put in</th><th class="num">Taken out</th><th class="num">Dividends</th><th class="num">Value 31 Dec</th><th class="num">Return</th><th class="num">ASPI</th><th class="num">Bond</th></tr></thead>
      <tbody>${YEARS.slice().reverse().map((r) => `<tr><td><b>${r.y}</b>${r.y === curY ? " <small>so far</small>" : ""}</td><td class="num">${r.start === null ? "–" : big(r.start)}</td><td class="num">${big(r.put)}</td><td class="num">${r.out ? big(r.out) : "–"}</td>
        <td class="num">${r.dv ? big(r.dv) : "–"}</td><td class="num">${r.end === null ? "–" : big(r.end)}${r.y === curY ? " <small>today</small>" : ""}</td>
        <td class="num ${r.pct === null ? "" : r.pct >= 0 ? "up" : "down"}"><b>${r.pct === null ? "–" : `${sgn(r.pct)}%`}</b>${r.gain !== null ? `<br><small>${r.gain >= 0 ? "+" : "−"}${big(Math.abs(r.gain))}</small>` : ""}</td>
        <td class="num">${r.aspi === null ? "–" : `${sgn(r.aspi)}%`}</td><td class="num">${r.bond === null ? "–" : `${sgn(r.bond)}%`}</td></tr>`).join("")}</tbody></table></div>
      <p class="pf-note">Return = value at the end − value on 1 January − money put in + money taken out + dividends, on the value on 1 January plus the money put in that year. A year you started buying in starts from zero. ASPI and bond are for the same calendar year (the bond rate for the part of the year gone).</p></section>

    ${warn.length ? `<div class="pf-warn"><span aria-hidden="true">⚠️</span><div><b>Concentration</b><ul>${warn.map((w) => `<li>${w}</li>`).join("")}</ul></div></div>` : ""}

    <div class="pf-row">
      <section class="pf-box"><h2>🥧 Where the money is</h2><div class="pf-mix">${donut}<ul class="pf-legend">${legend}</ul></div></section>
      <section class="pf-box"><h2>📊 Return on each holding</h2>
        <div class="pf-vs">${rows.slice().sort((x, y) => y.totalPct - x.totalPct).map((r) => { const g = r.totalPct, top = Math.max(...rows.map((x) => Math.abs(x.totalPct)), 1);
          const wdt = Math.abs(g) / top * 50; return `<div class="pf-vs-r"><span>${App.esc(r.c.name.replace(/\s+PLC$/, "").replace(/ (Bank|Holdings|Company|Ceylon)$/, ""))}</span>
          <span class="pf-vs-bar"><i class="${g >= 0 ? "gain" : "loss"}" style="${g >= 0 ? "left:50%" : "right:50%"};width:${wdt.toFixed(1)}%"></i></span><b class="${g >= 0 ? "up" : "down"}">${sgn(g, 0)}%</b></div>`; }).join("")}</div>
        <p class="pf-note">Total return on what each holding cost, fees in, dividends received counted.</p></section>
    </div>

    ${bySector.map((g) => `<section class="pf-group"><h2><span class="sec-ic" aria-hidden="true">${g.p.ic}</span>${App.esc(g.p.name)} <span class="cat-count">${g.list.length}</span>
      <span class="pf-g-sum">${big(g.p.value)} · ${N(g.p.value / T.value * 100)}% of the portfolio</span></h2>
      <div class="pf-cards">${g.list.map(card).join("")}</div></section>`).join("")}

    <div class="pf-row">
      <section class="pf-box"><h2>📅 Coming dividends</h2><div class="pf-up">${UPCOMING.length ? "" : `<p class="pf-note">No dividend announced yet for what you hold.</p>`}${UPCOMING.map((u) => { const c = byCode.get(u.code), nm = c ? c.name : u.code;
        const amt = u.sharesFor * u.dps * (1 - DIV_TAX), dd = new Date(u.pay);
        return `<div class="pf-up-r"><span class="pf-cal"><small>${dd.toLocaleString("en-GB", { month: "short" })}</small><b>${dd.getDate()}</b></span>
          <span class="pf-up-n">${App.esc(nm.replace(/\s+PLC$/, ""))}<small>Rs ${N(u.dps, 2)} a share · ex-dividend ${App.date(u.ex)}${u.est ? " · expected, not declared" : ""}</small></span><b>${big(amt)}</b></div>`; }).join("")}</div>
        <p class="pf-note">After ${N(DIV_TAX * 100)}% tax, for the shares you hold now.</p></section>
      <section class="pf-box"><h2>🧾 Trades and dividends</h2><div class="pf-log">${TRADES.map((t) => ({ ...t, k: "t" })).concat(DIVS.map((x) => ({ ...x, k: "d" })))
        .sort((a, b) => b.d.localeCompare(a.d)).map((x) => { const c = byCode.get(x.code), nm = c ? c.name.replace(/\s+PLC$/, "") : x.code;
          if (x.k === "d") return `<div class="pf-log-r"><span class="pf-tag div">Dividend</span><span>${App.esc(nm)} · Rs ${N(x.dps, 2)} × ${N(x.shares)} = Rs ${N(x.shares * x.dps * (1 - DIV_TAX))} after tax</span><em>${App.date(x.d)}</em></div>`;
          const fee = x.fees; return `<div class="pf-log-r"><span class="pf-tag ${x.side}">${x.side === "buy" ? "Buy" : "Sell"}</span><span>${App.esc(nm)} · ${N(x.n)} × Rs ${N(x.p, 2)} <small>fees Rs ${N(fee)}</small></span><em>${App.date(x.d)}</em></div>`; }).join("")}</div></section>
    </div>`;
  if (App.reveal) App.reveal(root, ".pf-tiles, .pf-box, .pf-group");
  if (!model.example) {
    const lock = document.createElement("p"); lock.className = "pf-foot";
    lock.innerHTML = `🔒 Unlocked on this device${model.updated ? ` · last change ${App.date(model.updated.slice(0, 10))}` : ""} · <button type="button" class="pf-lockbtn">Lock</button>`;
    root.appendChild(lock);
    lock.querySelector("button").addEventListener("click", () => { try { localStorage.removeItem("pfPass"); } catch (e) { /* off */ } lockScreen(); });
  }
  }
})();
