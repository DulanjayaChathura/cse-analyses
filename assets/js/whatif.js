/* "What if?" panel on the company page.
   Recalculates the adjustable methods from the analysis's `modelInputs` as you change them.
   Nothing is saved: reloading the page brings back the published analysis.
   The formulas are the same as scripts/valuation.py; keep the two in step. */
(function () {
  "use strict";
  const CASES = ["bear", "base", "bull"];
  const CASE_NAMES = { bear: "Bear", base: "Base", bull: "Bull" };
  const ADJUSTABLE = ["dcf", "pe", "ddm", "ri", "pb"];
  const ALIASES = { div: "ddm" };
  /* Which formula a published method uses (same as method_id in scripts/valuation.py): a sum of
     the parts that is a DCF plus other pieces uses the DCF, with the pieces fixed in dcf.addOn. */
  const methodId = (id, mi) => (id === "sotp" && mi && mi.dcf && mi.dcf.addOn != null ? "dcf" : ALIASES[id] || id);
  const pct = (x) => x / 100;
  const isNum = (x) => typeof x === "number" && isFinite(x);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fmt = (x, dp = 2) => (isNum(x) ? x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "–");
  const round = (x, step) => { const dp = Math.max(0, (String(step).split(".")[1] || "").length); return +x.toFixed(dp); };

  /* ---------- Formulas (same as scripts/valuation.py) ---------- */
  function need(r, gl, what) { if (!(r > gl)) throw new Error(`${what} must be above long-run growth`); }
  const F = {
    dcf(c, ke, wacc, mi, m) {
      const r = pct(wacc), g = pct(c.growth), gl = pct(c.longRun), roc = pct(c.roc), years = m.years || 5;
      need(r, gl, "WACC");
      if (!(roc > 0)) throw new Error("return on capital must be above 0");
      let cash = c.start, profit = c.nopat, value = 0;
      for (let t = 1; t <= years; t++) {
        cash *= 1 + g; profit *= 1 + g;
        value += (cash - (g / roc) * profit) / Math.pow(1 + r, t);
      }
      const after = (cash * (1 + gl) - (gl / roc) * profit * (1 + gl)) / (r - gl);
      value += after / Math.pow(1 + r, years);
      const add = (m.addOn && m.addOn[this.caseName]) || 0;
      return ((value - mi.netDebt) * 1000) / mi.shares + add;
    },
    pe(c, ke) {
      if (c.pe != null) return c.eps * c.pe;
      const r = pct(ke), gl = pct(c.longRun), roe = pct(c.roe);
      need(r, gl, "Cost of equity");
      return (c.eps * (1 - gl / roe)) / (r - gl);
    },
    ddm(c, ke, wacc, mi, m) {
      const r = pct(ke), g = pct(c.growth), gl = pct(c.longRun), years = m.years || 5;
      need(r, gl, "Cost of equity");
      let d = c.dividend, value = 0;
      for (let t = 1; t <= years; t++) {
        value += d / Math.pow(1 + r, t);
        if (t < years) d *= 1 + g;
      }
      return value + (d * (1 + gl)) / (r - gl) / Math.pow(1 + r, years);
    },
    ri(c, ke, wacc, mi, m) {
      const r = pct(ke), gl = pct(c.longRun), years = m.years || 10;
      need(r, gl, "Cost of equity");
      let b = m.book, value = m.book;
      for (let t = 1; t <= years; t++) {
        const roe = pct(m.roeStart) + (pct(c.roe) - pct(m.roeStart)) * (t / years);
        value += ((roe - r) * b) / Math.pow(1 + r, t);
        b += b * roe * (1 - pct(m.payout));
      }
      return value + ((pct(c.roe) - r) * b) / (r - gl) / Math.pow(1 + r, years);
    },
    pb(c, ke, wacc, mi, m) {
      const r = pct(ke), gl = pct(c.longRun);
      need(r, gl, "Cost of equity");
      return (m.book * (pct(c.roe) - gl)) / (r - gl);
    },
  };

  /* The formula shown behind each method's ⓘ. */
  const FORMULAS = {
    dcf: { f: "Σ free cash ÷ (1 + WACC)^year + value after year 5, then − net debt, ÷ shares",
      notes: ["Free cash = cash × (1 + growth) − growth ÷ return on capital × operating profit", "Value after year 5 = next year's free cash ÷ (WACC − g)", "g = long-run growth"] },
    pe: { f: "EPS × (1 − g ÷ ROE) ÷ (cost of equity − g)",
      notes: ["1 − g ÷ ROE = the share of profit that can be paid out while still funding growth", "g = long-run growth, ROE = long-run ROE"] },
    peFixed: { f: "EPS × P/E", notes: ["The P/E is set in the analysis, so the cost of equity doesn't change it"] },
    ddm: { f: "Σ dividend ÷ (1 + cost of equity)^year + last dividend × (1 + g) ÷ (cost of equity − g)",
      notes: ["Dividends grow at the years 1–5 rate, then at g", "g = long-run growth"] },
    ri: { f: "Book + Σ (ROE − cost of equity) × book ÷ (1 + cost of equity)^year + value after year 10",
      notes: ["ROE moves in a straight line to its long-run level by year 10", "Value after year 10 = (ROE − cost of equity) × book ÷ (cost of equity − g)"] },
    pb: { f: "Book × (ROE − g) ÷ (cost of equity − g)", notes: ["g = long-run growth, ROE = long-run ROE"] },
  };

  /* Inputs per method, for the "change a single input" lists. */
  const FIELDS = {
    dcf: [["start", "Start cash", "Rs bn"], ["nopat", "After-tax operating profit", "Rs bn"], ["growth", "Growth, years 1–5", "%"], ["longRun", "Long-run growth", "%"], ["roc", "Return on new capital", "%"]],
    pe: [["eps", "Next-year EPS", "Rs"], ["pe", "P/E (fixed)", "×"], ["roe", "Long-run ROE", "%"], ["longRun", "Long-run growth", "%"]],
    ddm: [["dividend", "Next-year dividend", "Rs"], ["growth", "Growth, years 1–5", "%"], ["longRun", "Long-run growth", "%"]],
    ri: [["roe", "Long-run ROE", "%"], ["longRun", "Long-run growth", "%"]],
    pb: [["roe", "Long-run ROE", "%"], ["longRun", "Long-run growth", "%"]],
  };
  const NAMES = { dcf: "DCF", pe: "P/E", ddm: "Dividend model", ri: "Residual income", pb: "Price to book" };

  /* Quick controls. You type the base-case figure; bear and bull keep their gap from it
     (added for rates, in proportion for rupee amounts). `ref` reads the published bear/base/bull. */
  const GROUPS = [
    { title: "Required return", items: [
      { key: "ke", label: "Cost of equity", unit: "%", step: 0.1, span: 5, kind: "add", uses: ADJUSTABLE,
        ref: (mi) => mi.costOfEquity, help: "The return a shareholder should demand. WACC moves with it." },
    ] },
    { title: "Growth", items: [
      { key: "longRun", label: "Long-run growth", unit: "%", step: 0.1, span: 3, kind: "add", uses: ADJUSTABLE, field: "longRun",
        help: "Growth after year 5 (after year 10 for residual income). Growth has to be paid for, so more growth also means more reinvestment." },
      { key: "growth", label: "Growth, years 1–5", unit: "%", step: 0.5, span: 5, kind: "add", uses: ["dcf", "ddm"], field: "growth" },
    ] },
    { title: "Earnings and dividends", items: [
      { key: "eps", label: "Next-year EPS", unit: "Rs", step: 0.05, spanPct: 30, kind: "mul", uses: ["pe"], field: "eps", only: "pe" },
      { key: "dividend", label: "Next-year dividend", unit: "Rs", step: 0.05, spanPct: 30, kind: "mul", uses: ["ddm"], field: "dividend", only: "ddm" },
      { key: "roe", label: "Long-run ROE", unit: "%", step: 0.5, span: 10, kind: "add", uses: ["pe", "ri", "pb"], field: "roe" },
    ] },
    { title: "Cash (DCF)", items: [
      { key: "maint", label: "Maintenance capex", unit: "Rs bn", step: 0.5, span: 15, kind: "add", uses: ["dcf"], field: "maintenance", only: "dcf",
        help: "Spending needed just to keep the business running. More maintenance means less cash left over." },
      { key: "roc", label: "Return on new capital", unit: "%", step: 0.5, span: 10, kind: "add", uses: ["dcf"], field: "roc", only: "dcf",
        help: "What new investment earns. Higher means each point of growth needs less reinvestment." },
    ] },
  ];

  /* Bear/base/bull published for a control: from the first method that has the field. */
  function refOf(item, mi, present) {
    if (item.ref) return item.ref(mi);
    const order = item.only ? [item.only] : ["dcf", "pe", "ddm", "ri", "pb"];
    for (const mid of order) {
      if (!present.includes(mid) || !mi[mid]) continue;
      const v = Object.fromEntries(CASES.map((c) => [c, mi[mid][c][item.field]]));
      if (CASES.every((c) => isNum(v[c]))) return v;
    }
    return null;
  }

  /* Applies the quick controls (as changes from the published base) to a copy of the edited inputs. */
  function applyQuick(mi, shift) {
    const x = clone(mi);
    x.costOfEquity = Object.fromEntries(CASES.map((c) => [c, mi.costOfEquity[c] + shift.ke]));
    if (mi.wacc) x.wacc = Object.fromEntries(CASES.map((c) => [c, mi.wacc[c] + (1 - pct(mi.debtWeight || 0)) * shift.ke]));
    for (const mid of ADJUSTABLE) {
      if (!x[mid]) continue;
      for (const c of CASES) {
        const s = x[mid][c];
        if (s.longRun != null) s.longRun += shift.longRun;
        if (s.growth != null) s.growth += shift.growth;
        if (s.roe != null) s.roe += shift.roe;
        if (mid === "pe") s.eps *= shift.eps;
        if (mid === "ddm") s.dividend *= shift.dividend;
        if (mid === "dcf") {
          s.start -= shift.maint;
          if (s.maintenance != null) s.maintenance += shift.maint;
          s.roc += shift.roc;
        }
      }
    }
    return x;
  }

  function compute(d, mi, weights) {
    const rows = d.models.map((m) => {
      const mid = methodId(m.id, mi);
      const row = { id: m.id, mid, name: m.name, adjustable: false, pub: m, errors: [] };
      if (ADJUSTABLE.includes(mid) && mi[mid]) {
        row.adjustable = true;
        for (const c of CASES) {
          try { F.caseName = c; row[c] = F[mid](mi[mid][c], mi.costOfEquity[c], mi.wacc && mi.wacc[c], mi, mi[mid]); }
          catch (e) { row[c] = null; row.errors.push(`${CASE_NAMES[c]}: ${e.message}`); }
        }
      } else {
        for (const c of CASES) row[c] = m[c];
      }
      row.weighted = CASES.every((c) => isNum(row[c])) ? CASES.reduce((s, c) => s + pct(weights[c]) * row[c], 0) : null;
      return row;
    });
    const ws = rows.map((r) => r.weighted).filter(isNum);
    const fair = ws.length === rows.length && ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null;
    return { rows, fair };
  }

  function mount(el, d, price) {
    const pub = clone(d.modelInputs);
    const v = d.valuation || {};
    const pubW = v.scenarioWeights || { bear: 30, base: 50, bull: 20 };
    const mos = v.marginOfSafety || { buy: 15, strongBuy: 25 };
    const present = ADJUSTABLE.filter((mid) => pub[mid] && d.models.some((m) => methodId(m.id, pub) === mid));
    const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => it.uses.some((u) => present.includes(u)) && refOf(it, pub, present)) }))
      .filter((g) => g.items.length);
    const items = groups.flatMap((g) => g.items);
    const NO_SHIFT = { ke: 0, longRun: 0, growth: 0, roe: 0, maint: 0, roc: 0, eps: 1, dividend: 1 };
    const state = { base: {}, edits: clone(pub), w: { ...pubW }, tab: "base" };
    items.forEach((it) => (state.base[it.key] = refOf(it, pub, present).base));

    // Changes from the published base, as applyQuick wants them.
    function shifts() {
      const s = { ...NO_SHIFT };
      for (const it of items) {
        const p = refOf(it, pub, present).base, now = state.base[it.key];
        if (!isNum(now)) continue;
        s[it.key] = it.kind === "mul" ? (p ? now / p : 1) : now - p;
      }
      return s;
    }

    const ctlHtml = (it) => {
      const p = refOf(it, pub, present).base;
      const span = it.span != null ? it.span : Math.max(Math.abs(p) * pct(it.spanPct), it.step * 10);
      const min = round(Math.max(it.unit === "%" && it.key !== "growth" ? 0 : -Infinity, p - span), it.step);
      const max = round(p + span, it.step);
      return `<div class="wi-ctl" data-ctl="${it.key}">
        <div class="wi-ctl-head"><label for="wi-${it.key}">${App.esc(it.label)}</label>
          ${it.help ? `<button type="button" class="wi-i" data-info="ctl:${it.key}" aria-label="About ${App.esc(it.label)}">ⓘ</button>` : ""}</div>
        <div class="wi-ctl-row">
          <button type="button" class="wi-step" data-step="${it.key}" data-dir="-1" aria-label="Lower ${App.esc(it.label)}">−</button>
          <span class="wi-num"><input id="wi-${it.key}" type="number" inputmode="decimal" step="${it.step}" data-n="${it.key}" value="${round(p, it.step)}">
            <small>${App.esc(it.unit)}</small></span>
          <button type="button" class="wi-step" data-step="${it.key}" data-dir="1" aria-label="Raise ${App.esc(it.label)}">+</button>
        </div>
        <input type="range" class="wi-range" data-r="${it.key}" min="${min}" max="${max}" step="${it.step}" value="${round(p, it.step)}" aria-label="${App.esc(it.label)}">
        <div class="wi-cases" data-cases="${it.key}"></div>
      </div>`;
    };

    el.innerHTML = `
      <p class="wi-intro">Type a base-case figure, or use − / + and the slider; bear and bull move with it. Nothing is saved: Reset, or reload the page, brings back the published analysis.</p>
      <div class="wi-bar" role="status" aria-live="polite"></div>
      <div class="wi-grid">
        <div class="wi-controls">
          ${groups.map((g) => `<fieldset class="wi-group"><legend>${App.esc(g.title)}</legend>${g.items.map(ctlHtml).join("")}</fieldset>`).join("")}
          <fieldset class="wi-group"><legend>Scenario weights</legend>
            <div class="wi-weights">${CASES.map((c) => `<label class="wi-w"><span>${CASE_NAMES[c]}</span>
              <input type="number" inputmode="numeric" min="0" max="100" step="5" data-w="${c}" value="${pubW[c]}"><small>%</small></label>`).join("")}</div>
            <div class="wi-cases" data-cases="w"></div>
          </fieldset>
        </div>
        <div class="wi-results">
          <div class="wi-methods"></div>
          <details class="more wi-detail"><summary>Change a single input</summary>
            <p class="wi-intro">The published inputs for one case at a time. The controls above are added on top.</p>
            <div class="wi-tabs" role="tablist">${CASES.map((c) => `<button type="button" role="tab" data-tab="${c}" aria-selected="${c === "base"}">${CASE_NAMES[c]}</button>`).join("")}</div>
            <div class="wi-fields"></div>
          </details>
        </div>
      </div>
      <div class="wi-sheet" hidden><div class="wi-sheet-box" role="dialog" aria-modal="false"><button type="button" class="wi-sheet-x" aria-label="Close">×</button><div class="wi-sheet-body"></div></div></div>`;

    const bar = el.querySelector(".wi-bar"), methodsEl = el.querySelector(".wi-methods"), fieldsEl = el.querySelector(".wi-fields");
    const sheet = el.querySelector(".wi-sheet"), sheetBody = el.querySelector(".wi-sheet-body");

    function renderFields() {
      const c = state.tab;
      el.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === c));
      fieldsEl.innerHTML = present.map((mid) => {
        const fields = FIELDS[mid].filter(([k]) => pub[mid][c][k] != null);
        return `<div class="wi-fieldset"><h4>${NAMES[mid]}</h4>${fields.map(([k, label, unit]) => {
          const val = state.edits[mid][c][k], edited = val !== pub[mid][c][k];
          return `<label class="wi-field"><span>${App.esc(label)}</span><span class="wi-num"><input type="number" inputmode="decimal" step="any"
            data-e="${mid}.${c}.${k}" value="${val}" class="${edited ? "wi-edited" : ""}"><small>${App.esc(unit)}</small></span></label>`;
        }).join("")}</div>`;
      }).join("");
    }

    let last = null;
    function render() {
      const mi = applyQuick(state.edits, shifts());
      const wsum = CASES.reduce((s, c) => s + (+state.w[c] || 0), 0);
      const weights = wsum > 0 ? Object.fromEntries(CASES.map((c) => [c, ((+state.w[c] || 0) * 100) / wsum])) : pubW;
      const r = compute(d, mi, weights);
      last = { mi, r };
      const fair = r.fair, buy = isNum(fair) ? fair * (1 - pct(mos.buy)) : null, strong = isNum(fair) ? fair * (1 - pct(mos.strongBuy)) : null;
      const chg = (now, was) => (isNum(now) && isNum(was) && was && Math.abs(now / was - 1) >= 0.0005
        ? `<span class="wi-chg ${now > was ? "up" : "down"}">${now > was ? "▲" : "▼"} ${fmt(Math.abs((now / was - 1) * 100), 1)}%</span>` : "");
      const gap = isNum(price) && isNum(buy) ? (price / buy - 1) * 100 : null;
      const changed = items.some((it) => Math.abs(state.base[it.key] - refOf(it, pub, present).base) > 1e-9)
        || CASES.some((c) => +state.w[c] !== pubW[c]) || JSON.stringify(state.edits) !== JSON.stringify(pub);
      bar.innerHTML = `
        <div class="wi-bar-item"><span>Fair value</span><b>Rs ${fmt(fair)}</b>${chg(fair, v.fairValue)}<small>was Rs ${fmt(v.fairValue)}</small></div>
        <div class="wi-bar-item"><span>Buy price</span><b>Rs ${fmt(buy)}</b>${chg(buy, v.buyPrice)}<small>strong buy Rs ${fmt(strong)}</small></div>
        <div class="wi-bar-gap ${isNum(gap) && gap <= 0 ? "good" : ""}">${isNum(gap) ? `Price Rs ${fmt(price)} is <b>${fmt(Math.abs(gap), 1)}% ${gap <= 0 ? "below" : "above"}</b> this buy price` : ""}</div>
        <button type="button" class="wi-reset" ${changed ? "" : "disabled"}>Reset</button>`;
      const errs = r.rows.flatMap((x) => x.errors.map((e) => `${x.name} (${e})`));
      methodsEl.innerHTML = `${wsum !== 100 ? `<p class="wi-warn">The weights add up to ${fmt(wsum, 0)}%, so they've been scaled to 100%.</p>` : ""}
        ${errs.length ? `<p class="wi-warn">${errs.map(App.esc).join("<br>")}</p>` : ""}
        ${r.rows.map((x) => `<div class="wi-m ${x.adjustable ? "" : "fixed"}">
          <div class="wi-m-head"><span class="wi-m-name">${App.esc(x.name)}</span>
            <button type="button" class="wi-i" data-info="m:${App.esc(x.id)}" aria-label="Formula for ${App.esc(x.name)}">ⓘ</button>
            ${x.adjustable ? "" : `<span class="wi-fixed">fixed</span>`}</div>
          <div class="wi-m-vals">
            <div class="wi-m-main"><small>Weighted</small><b>${isNum(x.weighted) ? "Rs " + fmt(x.weighted) : "–"}</b>${chg(x.weighted, x.pub.weighted)}</div>
            ${CASES.map((c) => `<div class="wi-m-case ${c}"><small>${CASE_NAMES[c]}</small><span>${fmt(x[c])}</span>${
              isNum(x[c]) && isNum(x.pub[c]) && Math.abs(x[c] - x.pub[c]) >= 0.005 ? `<em>was ${fmt(x.pub[c])}</em>` : ""}</div>`).join("")}
          </div></div>`).join("")}`;
      // The line under each control: all three cases, plus the published base once changed.
      for (const it of items) {
        const p = refOf(it, pub, present), now = refOf(it, mi, present);
        const dp = it.unit === "Rs" ? 2 : 1, u = it.unit === "%" ? "%" : "";
        const box = el.querySelector(`[data-cases="${it.key}"]`);
        const moved = Math.abs(state.base[it.key] - p.base) > 1e-9;
        if (box) box.innerHTML = `${CASES.map((c) => `<span class="${c}">${CASE_NAMES[c]} ${fmt(now[c], dp)}${u}</span>`).join("")}${
          moved ? `<span class="wi-pub">published ${fmt(p.base, dp)}${u}</span>` : ""}${
          it.key === "ke" && mi.wacc ? `<span class="wi-pub">WACC ${fmt(mi.wacc.base, 1)}%</span>` : ""}`;
        el.querySelector(`[data-ctl="${it.key}"]`).classList.toggle("moved", moved);
      }
      const wbox = el.querySelector('[data-cases="w"]');
      if (wbox) wbox.innerHTML = CASES.some((c) => +state.w[c] !== pubW[c]) ? `<span class="wi-pub">published ${CASES.map((c) => pubW[c]).join(" / ")}</span>` : "";
    }

    function setBase(key, val, from) {
      const it = items.find((x) => x.key === key);
      if (!it || !isNum(val)) return;
      state.base[key] = val;
      el.querySelectorAll(`[data-n="${key}"], [data-r="${key}"]`).forEach((o) => { if (o !== from) o.value = round(val, it.step); });
      render();
    }

    function openInfo(key) {
      let html = "";
      if (key.startsWith("ctl:")) {
        const it = items.find((x) => x.key === key.slice(4));
        html = `<h4>${App.esc(it.label)}</h4><p>${App.esc(it.help)}</p>`;
      } else {
        const x = last.r.rows.find((row) => row.id === key.slice(2));
        if (x.adjustable) {
          const f = FORMULAS[x.mid === "pe" && last.mi.pe && last.mi.pe.base.pe != null ? "peFixed" : x.mid];
          const add = x.mid === "dcf" && last.mi.dcf.addOn ? last.mi.dcf.addOn : null;
          const notes = add ? [...f.notes, `Plus the other parts, fixed (they don't move with the controls): Rs ${CASES.map((c) => fmt(add[c])).join(" / ")} a share (bear / base / bull)${last.mi.dcf.addOnNote ? `: ${last.mi.dcf.addOnNote}` : ""}`] : f.notes;
          html = `<h4>${App.esc(x.name)}</h4><p class="wi-formula">${App.esc(add ? f.f.replace(", ÷ shares", ", ÷ shares, + other parts") : f.f)}</p><ul>${notes.map((n) => `<li>${App.esc(n)}</li>`).join("")}</ul>
            <p class="wi-sheet-note">Worked out for bear, base and bull, then weighted ${CASES.map((c) => fmt(+state.w[c], 0)).join(" / ")}.</p>`;
        } else {
          html = `<h4>${App.esc(x.name)}</h4><p>Valued as in the analysis and not recalculated here, so the controls don't change it.</p>${
            x.pub.comment ? `<p class="wi-sheet-note">${App.esc(x.pub.comment)}</p>` : ""}`;
        }
      }
      sheetBody.innerHTML = html;
      sheet.hidden = false;
      sheet.querySelector(".wi-sheet-x").focus();
    }
    const closeInfo = () => { sheet.hidden = true; };

    el.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.n || t.dataset.r) setBase(t.dataset.n || t.dataset.r, parseFloat(t.value), t);
      else if (t.dataset.w) { state.w[t.dataset.w] = parseFloat(t.value) || 0; render(); }
      else if (t.dataset.e) {
        const [mid, c, k] = t.dataset.e.split("."), val = parseFloat(t.value);
        state.edits[mid][c][k] = isNum(val) ? val : pub[mid][c][k];
        t.classList.toggle("wi-edited", state.edits[mid][c][k] !== pub[mid][c][k]);
        render();
      }
    });
    el.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) { if (e.target === sheet) closeInfo(); return; }
      if (t.dataset.step) {
        const it = items.find((x) => x.key === t.dataset.step);
        setBase(it.key, round(state.base[it.key] + it.step * +t.dataset.dir, it.step));
      } else if (t.dataset.info) openInfo(t.dataset.info);
      else if (t.classList.contains("wi-sheet-x")) closeInfo();
      else if (t.dataset.tab) { state.tab = t.dataset.tab; renderFields(); }
      else if (t.classList.contains("wi-reset")) {
        state.edits = clone(pub);
        state.w = { ...pubW };
        items.forEach((it) => (state.base[it.key] = refOf(it, pub, present).base));
        items.forEach((it) => el.querySelectorAll(`[data-n="${it.key}"], [data-r="${it.key}"]`).forEach((o) => (o.value = round(state.base[it.key], it.step))));
        el.querySelectorAll("[data-w]").forEach((o) => (o.value = pubW[o.dataset.w]));
        renderFields();
        render();
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeInfo(); });

    renderFields();
    render();
  }

  window.WhatIf = { mount, compute, applyQuick, F };
})();
