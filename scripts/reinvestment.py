"""Reinvestment, capex, R&D and growth check for one company, from its research record.

    python scripts/reinvestment.py DIAL                      the figures
    python scripts/reinvestment.py DIAL --assumed 3,6,8      ... and check bear/base/bull growth (%)
    python scripts/reinvestment.py DIAL --long-run 4         ... and the reinvestment 4% long-run growth needs
    python scripts/reinvestment.py DIAL --eps 3.3,4,4.4      ... and check next-year EPS against the run-rate
    python scripts/reinvestment.py DIAL --dcf "start=26,33,37;nopat=36,40,44;growth=3,6,8;longrun=4,5,6;roc=15,20,25"
                                                             ... and value the whole company (WACC, minus net debt)
    python scripts/reinvestment.py DIAL --json               machine-readable

Uses the latest annual period in research/<CODE>/record.json (and the one before it for opening
capital and R&D history). Figures it needs but can't find are listed, never guessed; the one
labelled fallback is Sri Lanka's standard 30% tax rate when no tax rate is recorded.
It also works out the required return (beta and CAPM, from research/market-inputs.json and the
record's `Beta` input), WACC, and a maintenance capex range. See "Reinvestment, capex and R&D" and
"Required return and the DCF" in CLAUDE.md for how the results are used.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOLERANCE = 2.0          # percentage points a scenario may exceed the supported growth without a reason
RD_MATERIAL_PCT = 2.0    # R&D at least this % of revenue ...
RD_MIN_YEARS = 3         # ... with at least this many years of figures
STATUTORY_TAX = 30.0     # used only when no tax rate is recorded, and labelled
FINANCIAL_WORDS = ("bank", "financ", "insurance", "assurance", "leasing", "primary dealer")

ALIASES = {
    "capex": ("capexPaid", "capex"),
    "depreciation": ("depreciation", "depreciationAmortisation", "depreciationAndAmortisation"),
    "maintenanceCapex": ("maintenanceCapex",),
    "workingCapitalChange": ("workingCapitalChange",),
    "acquisitions": ("acquisitions",),
    "operatingProfit": ("operatingProfit",),
    "taxRate": ("taxRate",),
    "equity": ("totalEquity", "equityOwners", "equity"),
    "netDebt": ("netDebt",),
    "netProfit": ("netProfitOwners", "netProfit", "profitAfterTax"),
    "revenue": ("revenue",),
    "operatingCashFlow": ("operatingCashFlow",),
    "dividendsPaid": ("dividendsPaid", "dividendPaid"),
    "eps": ("eps",),
    "dps": ("dividendPerShare",),
    "roe": ("roe",),
    "rdExpensed": ("rdExpensed",),
    "interestPaid": ("interestPaid",),
    "borrowings": ("borrowings",),
    "leases": ("leaseLiabilities",),
    "shares": ("sharesOutstanding",),
    "capexBooked": ("capexBooked",),
    "impairment": ("impairment",),
    "licenceAmortisation": ("licenceAmortisation",),
    "growthCapexNamed": ("growthCapexNamed",),
}
BETA_LOW, BETA_HIGH = 0.3, 2.0     # outside this, the beta needs checking (house limits)
TERMINAL_HEAVY = 75.0              # % of DCF value from after the growth years that earns a note


def find_record(code):
    code = code.upper()
    for d in sorted((ROOT / "research").glob(f"{code.split('.')[0]}*")):
        if (d / "record.json").exists() and (d.name == code or d.name.split(".")[0] == code.split(".")[0]):
            import derived  # worked-out figures come from code, not from the record (derived.py)
            return d.name, derived.augment(json.loads((d / "record.json").read_text(encoding="utf-8")))
    return None, None


def fig(period, key):
    figs = (period or {}).get("figures") or {}
    for name in ALIASES[key]:
        f = figs.get(name)
        if isinstance(f, dict) and isinstance(f.get("value"), (int, float)):
            return f
    return None


def bn(period, key):
    """An amount in Rs bn, or None."""
    f = fig(period, key)
    if not f:
        return None
    unit = (f.get("unit") or "").strip()
    if unit == "Rs bn":
        return float(f["value"])
    if unit in ("Rs mn", "mn"):
        return float(f["value"]) / 1000
    return None


def plain(period, key):
    """A per-share or % figure, or None."""
    f = fig(period, key)
    return float(f["value"]) if f else None


def pct(x):
    return None if x is None else round(x * 100, 1)


def sector_of(ticker):
    p = ROOT / "data" / f"{ticker}.json"
    if not p.exists():
        return ""
    d = json.loads(p.read_text(encoding="utf-8"))
    return ((d.get("company") or {}).get("sector") or d.get("sector") or "").lower()


def rd_life(record, sector):
    for v in record.get("valuationInputs") or []:
        if (v.get("name") or "").lower() == "r&d life":
            m = re.search(r"\d+", str(v.get("value")))
            if m:
                return int(m.group()), "saved input"
    if any(w in sector for w in ("pharma", "health", "hospital", "medic")):
        return 10, "default for pharma/health"
    if any(w in sector for w in ("telecom", "tech", "software", "digital", "mobile", "app")):
        return 3, "default for tech/telecom"
    return 5, "default"


def maint_range(last, annuals):
    """Maintenance capex stand-ins, highest (bear) to lowest (bull); None if depreciation is missing."""
    cands = []
    dep = bn(last, "depreciation")
    if dep is None:
        return None
    cands.append(("depreciation as reported", dep))
    imp, lic = bn(last, "impairment"), bn(last, "licenceAmortisation")
    if imp is not None or lic is not None:
        cands.append(("depreciation less impairment and licence amortisation", dep - (imp or 0) - (lic or 0)))
    booked = [bn(p, "capexBooked") for p in annuals[-3:] if bn(p, "capexBooked") is not None]
    named = bn(last, "growthCapexNamed")
    if booked:
        cands.append((f"average capex booked over {len(booked)} year{'s' if len(booked) > 1 else ''}", sum(booked) / len(booked)))
        if named is not None and bn(last, "capexBooked") is not None:
            cands.append(("capex booked less named growth projects", bn(last, "capexBooked") - named))
    vals = sorted(v for _, v in cands)
    n = len(vals)
    mid = vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2
    return {"candidates": [{"basis": k, "value": round(v, 3)} for k, v in cands],
            "bear": round(vals[-1], 3), "base": round(mid, 3), "bull": round(vals[0], 3)}


def analyse(code, assumed=None, long_run=None):
    ticker, record = find_record(code)
    if not record:
        return {"error": f"No research record found for {code}."}
    sector = sector_of(ticker)
    financial = any(w in sector for w in FINANCIAL_WORDS)
    annuals = sorted([p for p in record.get("periods") or [] if p.get("type") == "annual"],
                     key=lambda p: p.get("periodEnd") or "")
    if not annuals:
        return {"ticker": ticker, "error": "No annual period in the research record."}
    last = annuals[-1]
    prev = annuals[-2] if len(annuals) > 1 else None
    out = {"ticker": ticker, "sector": sector, "financial": financial,
           "period": last.get("period"), "periodEnd": last.get("periodEnd"),
           "missing": [], "notes": [], "warnings": []}

    # Equity route: share of profit kept x ROE (all companies).
    roe = plain(last, "roe")
    if roe is None:
        np_, eq0 = bn(last, "netProfit"), bn(prev, "equity") or bn(last, "equity")
        roe = np_ / eq0 * 100 if np_ is not None and eq0 else None
    eps, dps = plain(last, "eps"), plain(last, "dps")
    payout = dps / eps if eps and dps is not None and eps > 0 else None
    if payout is None and bn(last, "dividendsPaid") is not None and bn(last, "netProfit"):
        payout = bn(last, "dividendsPaid") / bn(last, "netProfit")
    retention = max(0.0, 1 - payout) if payout is not None else None
    out["equityRoute"] = {
        "roePct": None if roe is None else round(roe, 1),
        "payoutPct": pct(payout), "retentionPct": pct(retention),
        "supportedGrowthPct": round(retention * roe, 1) if retention is not None and roe is not None else None,
    }
    if roe is None:
        out["missing"].append("ROE (or net profit and equity)")
    if payout is None:
        out["missing"].append("dividend per share and EPS (or dividends paid)")

    # R&D (any company that discloses it).
    rd_years = [(p.get("period"), bn(p, "rdExpensed")) for p in annuals if bn(p, "rdExpensed") is not None]
    revenue = bn(last, "revenue")
    rd = {"yearsOfFigures": len(rd_years), "material": False}
    rd_net = 0.0
    if rd_years and rd_years[-1][0] == last.get("period"):
        r0 = rd_years[-1][1]
        rd["latest"] = round(r0, 3)
        rd["pctOfRevenue"] = round(r0 / revenue * 100, 2) if revenue else None
        if rd["pctOfRevenue"] is not None and rd["pctOfRevenue"] >= RD_MATERIAL_PCT and len(rd_years) >= RD_MIN_YEARS:
            life, why = rd_life(record, sector)
            series = [v for _, v in rd_years][::-1]          # newest first
            asset = sum(v * (1 - k / life) for k, v in enumerate(series[:life]))
            amort = sum(v / life for v in series[1:life + 1])
            # Opening research asset (previous year-end), for return on capital.
            rd["openingAsset"] = round(sum(v * (1 - k / life) for k, v in enumerate(series[1:life + 1])), 3)
            np_ = bn(last, "netProfit")
            eq = bn(last, "equity")
            rd.update({"material": True, "lifeYears": life, "lifeBasis": why,
                       "researchAsset": round(asset, 3), "amortisation": round(amort, 3)})
            if len(series) < life + 1:
                out["notes"].append(f"R&D history is {len(series)} years, shorter than the {life}-year life: "
                                    "amortisation is understated, so adjusted profit is a little high.")
            if np_ is not None:
                adj = np_ + r0 - amort
                rd["adjustedProfit"] = round(adj, 3)
                rd["peMultiplier"] = round(np_ / adj, 3) if adj > 0 else None
            if eq is not None:
                rd["adjustedEquity"] = round(eq + asset, 3)
                if "adjustedProfit" in rd:
                    rd["adjustedRoePct"] = round(rd["adjustedProfit"] / (eq + asset) * 100, 1)
            rd_net = r0 - amort
        if len(rd_years) >= 2 and rd_years[-2][1] and r0 < rd_years[-2][1] * 0.67:
            p0, p1 = bn(last, "netProfit"), bn(prev, "netProfit")
            if p0 and p1 and p0 > p1 * 1.2:
                out["warnings"].append("R&D cut by a third or more while profit rose over 20%: the profit gain may not last.")
    out["rd"] = rd

    # Firm route: capex, maintenance vs growth, reinvestment, return on capital.
    if not financial:
        booked = bn(last, "capexBooked")
        capex, dep = (booked if booked is not None else bn(last, "capex")), bn(last, "depreciation")
        for name, v in (("capex", capex), ("depreciation", dep)):
            if v is None:
                out["missing"].append(name)
        firm = {}
        mr = maint_range(last, annuals)
        if mr:
            out["maintenanceRange"] = mr
            if len(mr["candidates"]) == 1:
                out["notes"].append("Only one maintenance capex stand-in recorded (depreciation): record capex booked, "
                                    "impairment, licence amortisation and named growth projects for a range.")
        if capex is not None and dep is not None:
            maint = bn(last, "maintenanceCapex")
            if maint is not None:
                basis = "company split"
            elif len(mr["candidates"]) > 1:
                maint, basis = mr["base"], "middle of the maintenance range"
            else:
                maint, basis = dep, "depreciation (may over- or understate)"
            firm["capexBasis"] = "booked (additions)" if booked is not None else "paid (cash flow)"
            wc, acq = bn(last, "workingCapitalChange"), bn(last, "acquisitions")
            if wc is None:
                out["missing"].append("working capital change (taken as 0)")
            if acq is None:
                out["missing"].append("acquisitions (taken as 0)")
            reinvest = (capex - dep) + (wc or 0) + (acq or 0) + rd_net
            firm.update({"capex": round(capex, 3), "depreciation": round(dep, 3),
                         "maintenanceCapex": round(maint, 3), "maintenanceBasis": basis,
                         "growthCapex": round(capex - maint, 3),
                         "growthCapexPct": round((capex - maint) / capex * 100, 1) if capex else None,
                         "reinvestment": round(reinvest, 3)})
            ocf = bn(last, "operatingCashFlow")
            if ocf is not None:
                firm["cashBeforeGrowthSpending"] = round(ocf - maint, 3)
                divs = bn(last, "dividendsPaid")
                if divs:
                    firm["dividendCover"] = round((ocf - maint) / divs, 2)
                    if ocf - maint < divs:
                        out["warnings"].append("Dividends are more than cash after maintenance capex: dividend at risk.")
            op = bn(last, "operatingProfit")
            tax = plain(last, "taxRate")
            if tax is None:
                tax = STATUTORY_TAX
                out["notes"].append("No tax rate recorded: Sri Lanka's standard 30% used.")
            if op is None:
                out["missing"].append("operating profit")
            else:
                # With R&D treated as investment, operating profit adds back R&D less its amortisation
                # and capital includes the research asset, consistent with the reinvestment above.
                nopat = (op + rd_net) * (1 - tax / 100)
                src = prev if prev and bn(prev, "equity") is not None and bn(prev, "netDebt") is not None else last
                eq_c, nd_c = bn(src, "equity"), bn(src, "netDebt")
                firm["afterTaxOperatingProfit"] = round(nopat, 3)
                if nopat > 0:
                    firm["reinvestmentRatePct"] = round(reinvest / nopat * 100, 1)
                rd_cap = (rd.get("openingAsset", 0) if src is prev else rd.get("researchAsset", 0)) if rd.get("material") else 0
                if eq_c is not None and nd_c is not None and eq_c + nd_c + rd_cap > 0:
                    roc = nopat / (eq_c + nd_c + rd_cap)
                    firm["returnOnCapitalPct"] = round(roc * 100, 1)
                    firm["capitalBasis"] = "opening (previous year-end)" if src is prev else "year-end (no previous year)"
                    if nopat > 0:
                        firm["supportedGrowthPct"] = round(reinvest / nopat * roc * 100, 1)
                else:
                    out["missing"].append("equity and net debt (for return on capital)")
            # Warnings across years.
            caps = [(bn(p, "capex"), bn(p, "depreciation")) for p in annuals[-3:]]
            if len(caps) == 3 and all(c is not None and d is not None and c < d for c, d in caps):
                out["warnings"].append("Capex below depreciation for three years: possible under-investment.")
            if prev and bn(prev, "capex") and capex < bn(prev, "capex") * 0.7:
                p0, p1 = bn(last, "netProfit"), bn(prev, "netProfit")
                if p0 and p1 and p0 > p1 * 1.2:
                    out["warnings"].append("Capex cut by 30%+ while profit rose over 20%: the cash flow gain may not last.")
            nd0, nd1 = bn(prev, "netDebt"), bn(last, "netDebt")
            if nd0 is not None and nd1 is not None and capex > 0 and nd1 - nd0 >= 0.5 * capex:
                out["warnings"].append("Net debt rose by half or more of this year's capex: spending largely borrowed.")
        out["firmRoute"] = firm

    # Supported growth and the check.
    sup = (out.get("firmRoute") or {}).get("supportedGrowthPct")
    basis = "reinvestment rate × return on capital"
    if sup is None:
        sup, basis = out["equityRoute"]["supportedGrowthPct"], "share of profit kept × ROE"
        if not financial:
            out["notes"].append("Capex-based growth check not possible yet (figures missing): "
                                "used share of profit kept × ROE instead.")
    out["supportedGrowthPct"], out["supportedBasis"] = sup, basis
    if assumed and sup is not None:
        rows = []
        for name, a in zip(("bear", "base", "bull"), assumed):
            gap = round(a - sup, 1)
            rows.append({"scenario": name, "assumedPct": a, "gapPts": gap, "needsReason": gap > TOLERANCE})
        out["check"] = rows
        over = [r for r in rows if r["needsReason"]]
        out["growthCheckLine"] = (f"Assumed {' / '.join(f'{a:g}%' for a in assumed)}; supported {sup:g}% ({basis}). "
                                  + ("; ".join(f"{r['scenario'].capitalize()} {r['gapPts']:g} pts above: <reason or lower it>" for r in over)
                                     if over else "All within 2 pts."))
    if long_run is not None:
        ret = (out.get("firmRoute") or {}).get("returnOnCapitalPct") or out["equityRoute"]["roePct"]
        if ret:
            out["longRun"] = {"growthPct": long_run, "returnPct": ret,
                              "reinvestmentNeededPct": round(long_run / ret * 100, 1)}
    return out


# ---------------------------------------------------------------------------
# Required return, WACC, maintenance range, EPS run-rate and the whole-company DCF.

def first_number(text):
    m = re.search(r"-?\d+(?:\.\d+)?", str(text or ""))
    return float(m.group()) if m else None


def saved_input(record, name):
    for v in record.get("valuationInputs") or []:
        if (v.get("name") or "").strip().lower() == name.lower():
            return v
    return None


def latest(periods, key, getter=bn):
    """The newest period (by period end, longest span first) that has the figure."""
    best = None
    for p in periods:
        v = getter(p, key)
        if v is None:
            continue
        rank = (p.get("periodEnd") or "", p.get("months") or 0)
        if best is None or rank > best[0]:
            best = (rank, v, p.get("period"))
    return (best[1], best[2]) if best else (None, None)


def market_inputs():
    path = ROOT / "research" / "market-inputs.json"
    if not path.exists():
        return None
    m = json.loads(path.read_text(encoding="utf-8"))
    return {k: (m[k]["value"] if isinstance(m.get(k), dict) else None)
            for k in ("bondYield10y", "defaultSpread", "matureERP", "volatilityFactor", "taxRate", "scenarioSpread")} | {
            "sources": {k: f"{m[k]['source']} ({m[k]['date']})" for k in m if isinstance(m[k], dict) and "source" in m[k]}}


def share_price(ticker):
    path = ROOT / "generated" / "prices.json"
    if path.exists():
        s = (json.loads(path.read_text(encoding="utf-8")).get("symbols") or {}).get(ticker) or {}
        if isinstance(s.get("close"), (int, float)):
            return float(s["close"]), f"CSE close {s.get('priceDate')}"
    return None, None


def shares_mn(periods):
    best = None
    for p in periods:
        f = fig(p, "shares")
        if not f:
            continue
        unit = (f.get("unit") or "").strip().lower()
        v = float(f["value"]) * (1000 if unit == "bn" else 1)
        rank = (p.get("periodEnd") or "", p.get("months") or 0)
        if best is None or rank > best[0]:
            best = (rank, v)
    return best[1] if best else None


def capital(o, eps_assumed=None, dcf_spec=None, price=None):
    """Adds requiredReturn, maintenanceRange, epsCheck and dcf to the analyse() output."""
    if "error" in o:
        return o
    ticker, record = find_record(o["ticker"])
    periods = record.get("periods") or []
    annuals = sorted([p for p in periods if p.get("type") == "annual"], key=lambda p: p.get("periodEnd") or "")
    last = annuals[-1]
    m = market_inputs()
    rr = {"missing": []}
    o["requiredReturn"] = rr
    if not m or None in (m["bondYield10y"], m["defaultSpread"], m["matureERP"], m["volatilityFactor"]):
        rr["missing"].append("research/market-inputs.json (bond yield, default spread, mature ERP, volatility factor)")
        return o
    rf = m["bondYield10y"] - m["defaultSpread"]
    crp = m["defaultSpread"] * m["volatilityFactor"]
    erp = m["matureERP"] + crp
    rr.update({"bondYieldPct": m["bondYield10y"], "defaultSpreadPct": m["defaultSpread"],
               "riskFreePct": round(rf, 2), "matureErpPct": m["matureERP"],
               "countryPremiumPct": round(crp, 2), "totalErpPct": round(erp, 2), "sources": m["sources"]})
    b = saved_input(record, "Beta")
    beta = first_number(b.get("value")) if b else None
    if beta is None:
        rr["missing"].append("the `Beta` valuation input (see 'Required return and the DCF' in CLAUDE.md)")
    else:
        rr["beta"] = beta
        rr["betaBasis"] = b.get("reason")
        if not BETA_LOW <= beta <= BETA_HIGH:
            o["warnings"].append(f"Beta {beta:g} is outside {BETA_LOW:g}-{BETA_HIGH:g}: check it before using it.")
        ke = rf + beta * erp
        spread = m.get("scenarioSpread") or 1.5
        rr["costOfEquityPct"] = {"bear": round(ke + spread, 1), "base": round(ke, 1), "bull": round(ke - spread, 1)}
        rr["formula"] = (f"{rf:.2f}% + {beta:g} × ({m['matureERP']:g}% + {crp:.2f}%) = {ke:.1f}% "
                         f"(bear +{spread:g}, bull −{spread:g})")

    # WACC (companies that aren't banks, finance companies or insurers).
    tax = plain(last, "taxRate")
    tax_basis = "effective rate" if tax is not None else "standard rate"
    tax = tax if tax is not None else (m.get("taxRate") or STATUTORY_TAX)
    if not o["financial"]:
        net_debt, nd_period = latest(periods, "netDebt")
        if price is None:
            price, price_src = share_price(ticker)
        else:
            price_src = "given"
        sh = shares_mn(periods)
        interest = bn(last, "interestPaid")
        debt = (bn(last, "borrowings") or 0) + (bn(last, "leases") or 0)
        prev = annuals[-2] if len(annuals) > 1 else None
        debt0 = ((bn(prev, "borrowings") or 0) + (bn(prev, "leases") or 0)) if prev else 0
        avg_debt = (debt + debt0) / 2 if debt0 else debt
        if interest is not None and avg_debt > 0:
            kd, kd_basis = interest / avg_debt * 100, f"interest paid ÷ average borrowings and leases, {last.get('period')}"
        else:
            kd, kd_basis = m["bondYield10y"], "10-year bond yield (interest paid or borrowings not recorded)"
            if interest is None:
                rr["missing"].append(f"interest paid ({last.get('period')})")
        if kd < m["bondYield10y"] - 4 or kd > m["bondYield10y"] + 8:
            o["warnings"].append(f"Cost of debt {kd:.1f}% looks out of line with the {m['bondYield10y']:g}% bond yield: check interest and debt.")
        rr["costOfDebtPct"] = round(kd, 2)
        rr["costOfDebtBasis"] = kd_basis
        rr["taxRatePct"] = tax
        rr["taxBasis"] = tax_basis
        for name, v in (("net debt", net_debt), ("share price", price), ("shares outstanding", sh)):
            if v is None:
                rr["missing"].append(name)
        if None not in (net_debt, price, sh):
            equity_mv = price * sh / 1000              # Rs bn
            w_d = max(net_debt, 0) / (equity_mv + max(net_debt, 0))
            rr.update({"netDebt": round(net_debt, 3), "netDebtPeriod": nd_period, "price": price,
                       "priceSource": price_src, "sharesMn": sh, "marketCap": round(equity_mv, 2),
                       "debtWeightPct": round(w_d * 100, 1)})
            if "costOfEquityPct" in rr:
                rr["waccPct"] = {k: round((1 - w_d) * v + w_d * kd * (1 - tax / 100), 1)
                                 for k, v in rr["costOfEquityPct"].items()}

        # Cash before growth spending, before interest (for the whole-company DCF).
        ocf, ocf_period = latest(periods, "operatingCashFlow")
        ann_ocf = bn(last, "operatingCashFlow")
        f_int = fig(last, "interestPaid")
        section = (f_int or {}).get("section")
        o["firmCash"] = {"operatingCashFlow": None if ann_ocf is None else round(ann_ocf, 3),
                         "period": last.get("period"), "interestSection": section}
        if ann_ocf is not None and interest is not None:
            add_back = interest * (1 - tax / 100) if section == "operating" else 0.0
            o["firmCash"]["interestAddBack"] = round(add_back, 3)
            o["firmCash"]["beforeInterest"] = round(ann_ocf + add_back, 3)
            if section not in ("operating", "financing"):
                o["notes"].append("interestPaid has no `section` (operating or financing): interest not added back.")
            if "maintenanceRange" in o:
                o["firmCash"]["afterMaintenance"] = {k: round(ann_ocf + add_back - o["maintenanceRange"][k], 3)
                                                     for k in ("bear", "base", "bull")}

    # EPS run-rate: the base case shouldn't start below what the company is earning now.
    ttm = [p for p in periods if (p.get("months") == 12 and p.get("type") != "annual") or p is last]
    run, run_src = latest(ttm, "eps", plain)
    quarters = [p for p in periods if p.get("months") == 3]
    q, q_src = latest(quarters, "eps", plain)
    o["epsRunRate"] = {"latest12Months": run, "period": run_src,
                       "latestQuarterX4": None if q is None else round(q * 4, 2), "quarter": q_src}
    if eps_assumed:
        ref = max(x for x in (run, None if q is None else q * 4) if x is not None) if (run or q) else None
        if ref:
            o["epsRunRate"]["check"] = []
            for name, e in zip(("bear", "base", "bull"), eps_assumed):
                gap = (e / ref - 1) * 100
                o["epsRunRate"]["check"].append({"scenario": name, "eps": e, "vsRunRatePct": round(gap, 1)})
            base_gap = o["epsRunRate"]["check"][1]["vsRunRatePct"]
            if base_gap < -10:
                o["warnings"].append(f"Base-case EPS is {abs(base_gap):.0f}% below the run-rate (Rs {ref:.2f}): "
                                     "give a specific reason (a one-off, a known cost coming) or raise it.")

    if dcf_spec:
        o["dcf"] = firm_dcf(o, dcf_spec)
    return o


def parse_dcf(text):
    spec = {}
    for part in text.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            spec[k.strip().lower()] = [float(x) for x in v.split(",")]
    need = ("start", "nopat", "growth", "longrun", "roc")
    missing = [k for k in need if len(spec.get(k, [])) != 3]
    if missing:
        raise SystemExit(f"--dcf needs three values (bear,base,bull) for: {', '.join(missing)}")
    spec["years"] = int(spec.get("years", [5])[0])
    return spec


def firm_dcf(o, spec):
    """Whole-company DCF: cash before interest, less the reinvestment growth needs, at WACC, minus net debt."""
    rr = o.get("requiredReturn") or {}
    wacc = rr.get("waccPct")
    if o["financial"]:
        return {"error": "No DCF for banks, finance companies or insurers: use residual income."}
    if not wacc or rr.get("netDebt") is None or not rr.get("sharesMn"):
        return {"error": "WACC, net debt or shares missing: see requiredReturn.missing."}
    bond = rr.get("bondYieldPct")
    out = {"method": "whole company: cash before interest at WACC, minus net debt", "years": spec["years"],
           "netDebt": rr["netDebt"], "sharesMn": rr["sharesMn"], "scenarios": []}
    for i, name in enumerate(("bear", "base", "bull")):
        c, p = spec["start"][i], spec["nopat"][i]
        g1, g2, roc = spec["growth"][i] / 100, spec["longrun"][i] / 100, spec["roc"][i] / 100
        r = wacc[name] / 100
        row = {"scenario": name, "waccPct": wacc[name]}
        if g2 >= r or (bond and spec["longrun"][i] >= bond):
            row["error"] = f"long-run growth {spec['longrun'][i]:g}% must be below WACC and the {bond:g}% bond yield"
            out["scenarios"].append(row)
            continue
        pv = 0.0
        flows = []
        for t in range(1, spec["years"] + 1):
            c, p = c * (1 + g1), p * (1 + g1)
            free = c - g1 / roc * p
            flows.append(round(free, 2))
            pv += free / (1 + r) ** t
        c6, p6 = c * (1 + g2), p * (1 + g2)
        tv = (c6 - g2 / roc * p6) / (r - g2)
        pv_tv = tv / (1 + r) ** spec["years"]
        firm = pv + pv_tv
        equity = firm - rr["netDebt"]
        row.update({"freeCash": flows, "pvGrowthYears": round(pv, 2), "pvAfter": round(pv_tv, 2),
                    "afterSharePct": round(pv_tv / firm * 100, 1) if firm > 0 else None,
                    "firmValue": round(firm, 2), "equityValue": round(equity, 2),
                    "perShare": round(equity * 1000 / rr["sharesMn"], 2)})
        if row["afterSharePct"] and row["afterSharePct"] > TERMINAL_HEAVY:
            row["note"] = f"{row['afterSharePct']:g}% of the value comes after year {spec['years']}: say so in the text."
        out["scenarios"].append(row)
    return out


def show_capital(o):
    rr = o.get("requiredReturn") or {}
    if "riskFreePct" in rr:
        print(f"  Required return: risk-free {rr['riskFreePct']}% (bond {rr['bondYieldPct']}% − default spread "
              f"{rr['defaultSpreadPct']}%); ERP {rr['matureErpPct']}% + country {rr['countryPremiumPct']}%")
        if "formula" in rr:
            c = rr["costOfEquityPct"]
            print(f"    cost of equity {rr['formula']} → bear {c['bear']}% / base {c['base']}% / bull {c['bull']}%")
        if "costOfDebtPct" in rr:
            print(f"    cost of debt {rr['costOfDebtPct']}% ({rr['costOfDebtBasis']}), tax {rr['taxRatePct']:g}% ({rr['taxBasis']})")
        if "waccPct" in rr:
            w = rr["waccPct"]
            print(f"    market cap Rs {rr['marketCap']}bn at Rs {rr['price']:g} ({rr['priceSource']}), net debt Rs {rr['netDebt']}bn "
                  f"({rr['netDebtPeriod']}) → debt weight {rr['debtWeightPct']}%")
            print(f"    WACC bear {w['bear']}% / base {w['base']}% / bull {w['bull']}%")
    for x in rr.get("missing", []):
        print(f"  Required return missing: {x}")
    mr = o.get("maintenanceRange")
    if mr:
        print("  Maintenance capex range: bear Rs {bear}bn / base Rs {base}bn / bull Rs {bull}bn".format(**mr))
        for c in mr["candidates"]:
            print(f"    {c['basis']}: Rs {c['value']}bn")
    fc = o.get("firmCash") or {}
    if "beforeInterest" in fc:
        print(f"  Operating cash {fc['period']} Rs {fc['operatingCashFlow']}bn + after-tax interest added back "
              f"Rs {fc['interestAddBack']}bn (interest in {fc['interestSection'] or 'unknown section'}) = Rs {fc['beforeInterest']}bn")
        if "afterMaintenance" in fc:
            a = fc["afterMaintenance"]
            print(f"    less maintenance → start cash bear Rs {a['bear']}bn / base Rs {a['base']}bn / bull Rs {a['bull']}bn")
    er = o.get("epsRunRate") or {}
    if er.get("latest12Months") is not None or er.get("latestQuarterX4") is not None:
        print(f"  EPS run-rate: Rs {er['latest12Months']} ({er['period']}); latest quarter × 4 Rs {er['latestQuarterX4']} ({er['quarter']})")
        for c in er.get("check", []):
            print(f"    {c['scenario']:4}  EPS Rs {c['eps']:g}  {c['vsRunRatePct']:+g}% vs run-rate")
    d = o.get("dcf")
    if d:
        if "error" in d:
            print(f"  DCF: {d['error']}")
        else:
            print(f"  DCF ({d['method']}), net debt Rs {d['netDebt']}bn:")
            for r in d["scenarios"]:
                if "error" in r:
                    print(f"    {r['scenario']:4}  {r['error']}")
                    continue
                print(f"    {r['scenario']:4}  WACC {r['waccPct']}%  first-year free cash Rs {r['freeCash'][0]}bn  "
                      f"firm Rs {r['firmValue']}bn − net debt = Rs {r['equityValue']}bn → Rs {r['perShare']} a share "
                      f"({r['afterSharePct']}% after year {d['years']})")
                if r.get("note"):
                    print(f"          note: {r['note']}")


def show(o):
    if "error" in o:
        print(o["error"])
        return
    kind = "bank / finance / insurance" if o["financial"] else "non-financial"
    print(f"{o['ticker']}: {o['period']} (year to {o['periodEnd']}), {kind}")
    e = o["equityRoute"]
    print(f"  Share of profit kept × ROE: {e['retentionPct']}% × {e['roePct']}% = {e['supportedGrowthPct']}%")
    f = o.get("firmRoute") or {}
    if f:
        print(f"  Capex Rs {f['capex']}bn ({f['capexBasis']}); maintenance Rs {f['maintenanceCapex']}bn ({f['maintenanceBasis']}); "
              f"growth Rs {f['growthCapex']}bn ({f['growthCapexPct']}% of capex)")
        if "cashBeforeGrowthSpending" in f:
            print(f"  Cash before growth spending (operating cash − maintenance): Rs {f['cashBeforeGrowthSpending']}bn"
                  + (f"; covers dividends {f['dividendCover']}×" if "dividendCover" in f else ""))
        print(f"  Reinvestment Rs {f['reinvestment']}bn (capex − depreciation + working capital + acquisitions + net R&D)")
        if "returnOnCapitalPct" in f:
            print(f"  Reinvestment rate {f.get('reinvestmentRatePct')}% × return on capital {f['returnOnCapitalPct']}% "
                  f"({f['capitalBasis']}) = {f.get('supportedGrowthPct')}%")
    rd = o["rd"]
    if rd.get("material"):
        print(f"  R&D Rs {rd['latest']}bn ({rd['pctOfRevenue']}% of revenue), {rd['lifeYears']}-year life ({rd['lifeBasis']}): "
              f"research asset Rs {rd['researchAsset']}bn, amortisation Rs {rd['amortisation']}bn")
        if "adjustedProfit" in rd:
            print(f"  R&D-adjusted profit Rs {rd['adjustedProfit']}bn (P/E × {rd['peMultiplier']}), "
                  f"equity Rs {rd.get('adjustedEquity')}bn, ROE {rd.get('adjustedRoePct')}%")
    elif rd.get("latest") is not None:
        print(f"  R&D {rd['pctOfRevenue']}% of revenue, {rd['yearsOfFigures']} years of figures: no adjustment "
              f"(needs {RD_MATERIAL_PCT:g}%+ and {RD_MIN_YEARS}+ years)")
    else:
        print("  R&D: not recorded (no adjustment)")
    print(f"  Supported growth: {o['supportedGrowthPct']}% ({o['supportedBasis']})")
    for r in o.get("check", []):
        flag = "needs a reason or a lower figure" if r["needsReason"] else "ok"
        print(f"    {r['scenario']:4}  assumed {r['assumedPct']:g}%  gap {r['gapPts']:+g} pts  {flag}")
    if "growthCheckLine" in o:
        print(f"  Growth check input: {o['growthCheckLine']}")
    if "longRun" in o:
        lr = o["longRun"]
        print(f"  Long-run {lr['growthPct']:g}% growth at {lr['returnPct']}% return needs {lr['reinvestmentNeededPct']}% reinvested")
    show_capital(o)
    for w in o["warnings"]:
        print(f"  WARNING: {w}")
    for n in o["notes"]:
        print(f"  note: {n}")
    if o["missing"]:
        print("  Missing from the record: " + ", ".join(o["missing"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("code")
    ap.add_argument("--assumed", help="bear,base,bull growth %, e.g. 3,6,8")
    ap.add_argument("--long-run", type=float, help="long-run growth %")
    ap.add_argument("--eps", help="next-year EPS bear,base,bull, checked against the run-rate")
    ap.add_argument("--dcf", help='"start=..;nopat=..;growth=..;longrun=..;roc=..[;years=5]", three values each (Rs bn, %)')
    ap.add_argument("--price", type=float, help="share price (default: latest CSE close)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    assumed = [float(x) for x in a.assumed.split(",")] if a.assumed else None
    eps = [float(x) for x in a.eps.split(",")] if a.eps else None
    o = capital(analyse(a.code, assumed, a.long_run), eps, parse_dcf(a.dcf) if a.dcf else None, a.price)
    print(json.dumps(o, indent=1)) if a.json else show(o)
    return 1 if "error" in o else 0


if __name__ == "__main__":
    sys.exit(main())
