#!/usr/bin/env python3
"""The valuation formulas, in one place.

Each analysis saves the numbers its methods use in a `modelInputs` section (docs/json-format.md).
This script recalculates every adjustable method from them, so:
  - the analysis's method values come from code, not hand arithmetic;
  - the website's "What if?" panel (assets/js/whatif.js, the same formulas in JavaScript)
    starts from exactly the published figures;
  - validate.py can check the published values against the inputs.

Usage:
    python scripts/valuation.py DIAL                  recalculate from data/<CODE>.json's modelInputs
    python scripts/valuation.py DIAL inputs.json      ... from a separate inputs file
    python scripts/valuation.py DIAL inputs.json --write
        save inputs.json as modelInputs and put the recalculated bear/base/bull/weighted values
        into the matching `models` entries (names and comments untouched), then print the fair
        value, buy and strong-buy prices to copy into `valuation`.

Methods (rates and growth in %, money in Rs; `shares` in millions, `netDebt` and DCF cash in Rs bn):
  dcf  whole company: start cash and after-tax operating profit grow at `growth` for `years`;
       each year's free cash = cash − growth ÷ roc × operating profit; after that, the same at
       `longRun`; discounted at WACC; less net debt; per share.
  pe   next year's EPS × P/E. P/E = `pe` if given, else payout ÷ (cost of equity − longRun)
       with payout = 1 − longRun ÷ roe (forward justified P/E).
  ddm  next year's dividend, growing at `growth` for `years`, then `longRun`, at the cost of equity.
  ri   book + excess returns: ROE moves in a straight line from `roeStart` to `roe` by year `years`,
       book grows by ROE × (1 − payout); after year `years`, (roe − cost of equity) × book grows at
       `longRun`.
  pb   book × (roe − longRun) ÷ (cost of equity − longRun).
Other methods (NAV, sum of the parts, EV/EBITDA, dividend yield...) aren't recalculated: their
published values are used as they are.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASES = ("bear", "base", "bull")
ADJUSTABLE = ("dcf", "pe", "ddm", "ri", "pb")
ALIASES = {"div": "ddm"}          # older analyses call the dividend model "div"
TOLERANCE = 0.03                  # 3%, or Rs 0.10 for small values, counts as "matches"


def pct(x):
    return x / 100.0


def dcf(c, ke, wacc, shares, net_debt, years=5):
    r, g, gl, roc = pct(wacc), pct(c["growth"]), pct(c["longRun"]), pct(c["roc"])
    if r <= gl:
        raise ValueError("WACC must be above long-run growth")
    cash, profit, value = c["start"], c["nopat"], 0.0
    for t in range(1, years + 1):
        cash *= 1 + g
        profit *= 1 + g
        value += (cash - g / roc * profit) / (1 + r) ** t
    after = (cash * (1 + gl) - gl / roc * profit * (1 + gl)) / (r - gl)
    value += after / (1 + r) ** years
    return (value - net_debt) * 1000 / shares


def pe(c, ke, *_):
    if c.get("pe") is not None:
        return c["eps"] * c["pe"]
    r, gl, roe = pct(ke), pct(c["longRun"]), pct(c["roe"])
    if r <= gl:
        raise ValueError("cost of equity must be above long-run growth")
    return c["eps"] * (1 - gl / roe) / (r - gl)


def ddm(c, ke, years=5):
    r, g, gl = pct(ke), pct(c["growth"]), pct(c["longRun"])
    if r <= gl:
        raise ValueError("cost of equity must be above long-run growth")
    d, value = c["dividend"], 0.0
    for t in range(1, years + 1):
        value += d / (1 + r) ** t
        if t < years:
            d *= 1 + g
    return value + d * (1 + gl) / (r - gl) / (1 + r) ** years


def ri(c, ke, book, payout, roe_start, years=10):
    r, gl = pct(ke), pct(c["longRun"])
    if r <= gl:
        raise ValueError("cost of equity must be above long-run growth")
    b, value = book, book
    for t in range(1, years + 1):
        roe = pct(roe_start) + (pct(c["roe"]) - pct(roe_start)) * t / years
        value += (roe - r) * b / (1 + r) ** t
        b += b * roe * (1 - pct(payout))
    return value + (pct(c["roe"]) - r) * b / (r - gl) / (1 + r) ** years


def pb(c, ke, book):
    r, gl = pct(ke), pct(c["longRun"])
    if r <= gl:
        raise ValueError("cost of equity must be above long-run growth")
    return book * (pct(c["roe"]) - gl) / (r - gl)


def method_value(mid, mi, case, ke, wacc):
    m = mi[mid]
    c = m[case]
    if mid == "dcf":
        return dcf(c, ke, wacc, mi["shares"], mi["netDebt"], m.get("years", 5))
    if mid == "pe":
        return pe(c, ke)
    if mid == "ddm":
        return ddm(c, ke, m.get("years", 5))
    if mid == "ri":
        return ri(c, ke, m["book"], m["payout"], m["roeStart"], m.get("years", 10))
    if mid == "pb":
        return pb(c, ke, m["book"])
    raise KeyError(mid)


def recalc(data, mi=None):
    """Returns {models: [{id, bear, base, bull, weighted, adjustable}], fairValue, buyPrice, strongBuyPrice}."""
    mi = mi or data.get("modelInputs")
    if not mi:
        raise SystemExit("No modelInputs in the analysis (see docs/json-format.md).")
    v = data.get("valuation") or {}
    w = v.get("scenarioWeights") or {"bear": 30, "base": 50, "bull": 20}
    mos = v.get("marginOfSafety") or {"buy": 15, "strongBuy": 25}
    out = []
    for m in data.get("models") or []:
        mid = ALIASES.get(m.get("id"), m.get("id"))
        row = {"id": m.get("id"), "name": m.get("name")}
        if mid in ADJUSTABLE and mid in mi:
            for case in CASES:
                row[case] = round(method_value(mid, mi, case, mi["costOfEquity"][case],
                                               (mi.get("wacc") or {}).get(case)), 2)
            row["adjustable"] = True
        else:
            for case in CASES:
                row[case] = m.get(case)
            row["adjustable"] = False
        vals = [row[c] for c in CASES]
        row["weighted"] = (round(sum(pct(w[c]) * row[c] for c in CASES), 2)
                           if all(isinstance(x, (int, float)) for x in vals) else m.get("weighted"))
        out.append(row)
    ws = [r["weighted"] for r in out if isinstance(r["weighted"], (int, float))]
    fair = sum(ws) / len(ws) if ws else None
    return {"models": out, "fairValue": None if fair is None else round(fair, 2),
            "buyPrice": None if fair is None else round(fair * (1 - pct(mos["buy"])), 2),
            "strongBuyPrice": None if fair is None else round(fair * (1 - pct(mos["strongBuy"])), 2)}


def close(a, b):
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return a == b
    return abs(a - b) <= max(0.10, abs(b) * TOLERANCE)


def mismatches(data):
    """Published values that don't follow from modelInputs (for validate.py)."""
    if not data.get("modelInputs"):
        return []
    try:
        r = recalc(data)
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as e:
        return [f"modelInputs can't be recalculated: {e}"]
    probs = []
    pub = {m.get("id"): m for m in data.get("models") or []}
    for row in r["models"]:
        if not row["adjustable"]:
            continue
        m = pub[row["id"]]
        for c in CASES:
            if not close(row[c], m.get(c)):
                probs.append(f'{row["id"]} {c}: published {m.get(c)}, inputs give {row[c]}')
    fv = (data.get("valuation") or {}).get("fairValue")
    if not close(r["fairValue"], fv):
        probs.append(f"fair value: published {fv}, inputs give {r['fairValue']}")
    return probs


def find(code):
    code = code.upper()
    for p in sorted((ROOT / "data").glob("*.json")):
        if p.stem == code or p.stem.split(".")[0] == code:
            return p
    raise SystemExit(f"No data file for {code}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("code")
    ap.add_argument("inputs", nargs="?")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    path = find(a.code)
    data = json.loads(path.read_text(encoding="utf-8"))
    mi = json.loads(Path(a.inputs).read_text(encoding="utf-8")) if a.inputs else None
    r = recalc(data, mi)
    print(f"{path.stem}")
    for row in r["models"]:
        tag = "" if row["adjustable"] else "  (published, not recalculated)"
        print(f"  {row['id']:5} bear {row['bear']}  base {row['base']}  bull {row['bull']}  → {row['weighted']}{tag}")
    print(f"  fair value {r['fairValue']}  buy {r['buyPrice']}  strong buy {r['strongBuyPrice']}")
    if a.write:
        if mi is None:
            raise SystemExit("--write needs an inputs file.")
        data["modelInputs"] = mi
        by_id = {row["id"]: row for row in r["models"]}
        for m in data.get("models") or []:
            row = by_id.get(m.get("id"))
            if row and row["adjustable"]:
                for k in (*CASES, "weighted"):
                    m[k] = row[k]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Saved modelInputs and method values in {path.relative_to(ROOT)}. "
              "Copy the fair value, buy and strong-buy prices into `valuation`.")
    else:
        for p in mismatches({**data, **({"modelInputs": mi} if mi else {})}):
            print(f"  DIFFERS: {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
