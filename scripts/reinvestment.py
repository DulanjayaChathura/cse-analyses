"""Reinvestment, capex, R&D and growth check for one company, from its research record.

    python scripts/reinvestment.py DIAL                      the figures
    python scripts/reinvestment.py DIAL --assumed 3,6,8      ... and check bear/base/bull growth (%)
    python scripts/reinvestment.py DIAL --long-run 4         ... and the reinvestment 4% long-run growth needs
    python scripts/reinvestment.py DIAL --json               machine-readable

Uses the latest annual period in research/<CODE>/record.json (and the one before it for opening
capital and R&D history). Figures it needs but can't find are listed, never guessed; the one
labelled fallback is Sri Lanka's standard 30% tax rate when no tax rate is recorded.
See "Reinvestment, capex and R&D" in CLAUDE.md for how the results are used.
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
}


def find_record(code):
    code = code.upper()
    for d in sorted((ROOT / "research").glob(f"{code.split('.')[0]}*")):
        if (d / "record.json").exists() and (d.name == code or d.name.split(".")[0] == code.split(".")[0]):
            return d.name, json.loads((d / "record.json").read_text(encoding="utf-8"))
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
        capex, dep = bn(last, "capex"), bn(last, "depreciation")
        for name, v in (("capex", capex), ("depreciation", dep)):
            if v is None:
                out["missing"].append(name)
        firm = {}
        if capex is not None and dep is not None:
            maint = bn(last, "maintenanceCapex")
            basis = "company split" if maint is not None else "depreciation (tends to understate)"
            maint = maint if maint is not None else dep
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
        print(f"  Capex Rs {f['capex']}bn; maintenance Rs {f['maintenanceCapex']}bn ({f['maintenanceBasis']}); "
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
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    assumed = [float(x) for x in a.assumed.split(",")] if a.assumed else None
    o = analyse(a.code, assumed, a.long_run)
    print(json.dumps(o, indent=1)) if a.json else show(o)
    return 1 if "error" in o else 0


if __name__ == "__main__":
    sys.exit(main())
