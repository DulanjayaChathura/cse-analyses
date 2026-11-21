"""Figures worked out from the report figures in research/<CODE>/record.json.

The record keeps only what the reports print, each with its report and page. Everything worked
out from those figures (trailing twelve months, net debt, tax rate, free cash flow, EBITDA, ROE,
cash before interest, the maintenance capex range) is calculated here, from one definition each,
so a worked-out number is never typed, copied or left stale.

Definitions (amounts in Rs bn unless the figure is per share or %):
  capexPaid          = purchasePPE + purchaseIntangibles (when the record has the two lines)
  netDebt            = borrowings + leaseLiabilities − cash                         (CLAUDE.md)
  taxRate            = incomeTax ÷ profitBeforeTax × 100
  ebitda             = operatingProfit + depreciationAmortisation (else + depreciation)
  freeCashFlow       = operatingCashFlow − capexPaid − leasePrincipal
  cashBeforeInterest = operatingCashFlow + interestPaid × (1 − tax rate of the latest annual period)
                       when interest paid sits in operating cash flow (Damodaran: cash flow to the
                       firm is before interest); otherwise operatingCashFlow
  ttm.X              = latest annual X + this year's year-to-date X − last year's same period X
  ttm.roe            = ttm.netProfit ÷ average owners' equity at the start and end of those twelve
                       months × 100 (CFA Institute: ROE on average equity)
  quarterX4.X        = the latest quarter's X × 4 (a quarter is reported, or the year-to-date less
                       the previous year-to-date)
  latest.X           = the most recent period that reports X (or can work it out)
  annual.X           = the latest annual period's X
  maintenance.case   = scripts/reinvestment.py's maintenance capex range (bear / base / bull)

Model inputs can be filled from these: modelInputs.derive maps a field path to an expression,
e.g. {"dcf.base.start": "ttm.cashBeforeInterest - maintenance.base - 4.5"}. Any plain number in an
expression is an assumption, so the entry must name the valuationInputs entry that explains it:
{"calc": "...", "basis": "valuationInputs: <name>"}.

    python scripts/derived.py DIAL              every derived figure, and what's missing
    python scripts/derived.py DIAL --write      fill modelInputs from modelInputs.derive
"""
import ast
import datetime as dt
import json
import operator
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RESEARCH = ROOT / "research"
FLOWS = ("revenue", "grossProfit", "operatingProfit", "netProfit", "netProfitOwners", "eps", "operatingCashFlow",
         "interestPaid", "capexPaid", "purchasePPE", "purchaseIntangibles", "capexBooked", "depreciationAmortisation",
         "financeCosts", "incomeTax", "profitBeforeTax", "leasePrincipal", "dividendsPaid")
WORKED_OUT = ("netDebt", "taxRate", "ebitda", "freeCashFlow", "capexPaid", "cashBeforeInterest")


class Missing(Exception):
    pass


def _num(f, per_share=False):
    """A figure's value in Rs bn (or as reported for per-share and % figures); None if not reported."""
    if not isinstance(f, dict) or not isinstance(f.get("value"), (int, float)):
        return None
    unit = (f.get("unit") or "").strip().lower()
    v = float(f["value"])
    if unit in ("rs mn", "mn"):
        return v / 1000
    if unit in ("rs '000", "rs 000", "rs thousand"):
        return v / 1e6
    return v


def _end(p):
    return dt.date.fromisoformat(p["periodEnd"]) if p.get("periodEnd") else None


class Record:
    def __init__(self, record):
        self.rec = record
        self.periods = sorted(record.get("periods") or [], key=lambda p: (p.get("periodEnd") or "", p.get("months") or 0))
        self.annuals = [p for p in self.periods if p.get("type") == "annual"]

    # ---- reported figures and the per-period definitions ----
    def raw(self, p, key):
        return _num((p.get("figures") or {}).get(key))

    def section(self, p, key):
        return ((p.get("figures") or {}).get(key) or {}).get("section")

    def get(self, p, key):
        """A figure for one period: reported, or worked out from that period's reported figures."""
        if key == "depreciationAmortisation" and self.raw(p, key) is None:
            key = "depreciation"          # annual reports' "depreciation, impairment and amortisation"
        v = self.raw(p, key)
        if v is not None and key not in WORKED_OUT:
            return v
        if key == "capexPaid":
            a, b = self.raw(p, "purchasePPE"), self.raw(p, "purchaseIntangibles")
            return a + b if None not in (a, b) else v
        if key == "netDebt":
            b, l, c = self.raw(p, "borrowings"), self.raw(p, "leaseLiabilities"), self.raw(p, "cash")
            return b + l - c if None not in (b, l, c) else None
        if key == "taxRate":
            t, pbt = self.raw(p, "incomeTax"), self.raw(p, "profitBeforeTax")
            return t / pbt * 100 if None not in (t, pbt) and pbt else None
        if key == "ebitda":
            op = self.raw(p, "operatingProfit")
            da = self.raw(p, "depreciationAmortisation")
            da = da if da is not None else self.raw(p, "depreciation")
            return op + da if None not in (op, da) else v
        if key == "freeCashFlow":
            o, c, l = self.raw(p, "operatingCashFlow"), self.get(p, "capexPaid"), self.raw(p, "leasePrincipal")
            return o - c - l if None not in (o, c, l) else None
        return v

    # ---- which periods ----
    def annual(self):
        if not self.annuals:
            raise Missing(["an annual period"])
        return self.annuals[-1]

    def ytd(self):
        """The latest year-to-date interim after the latest annual (None if the annual is the latest)."""
        a = self.annual()
        later = [p for p in self.periods if p.get("type") != "annual" and p.get("periodEnd", "") > a["periodEnd"]
                 and (p.get("months") or 0) in (3, 6, 9) and not str(p.get("period", "")).startswith("Q")
                 or (p.get("type") != "annual" and p.get("periodEnd", "") > a["periodEnd"] and p.get("months") == 3
                     and (_end(p) - _end(a)).days < 100)]
        return max(later, key=lambda p: (p["periodEnd"], p.get("months") or 0)) if later else None

    def year_before(self, p):
        e = _end(p)
        want = e.replace(year=e.year - 1)
        for q in self.periods:
            if q is not p and _end(q) == want and q.get("months") == p.get("months") and q.get("type") == p.get("type"):
                return q
        return None

    # ---- named derived figures ----
    def ttm(self, key):
        a, y = self.annual(), self.ytd()
        if key == "roe":
            return self.ttm_roe()
        if key == "cashBeforeInterest":
            return self._cbi(lambda k: self.ttm(k), "ttm")
        if y is None:
            v = self.get(a, key)
            if v is None:
                raise Missing([f"{key} for {a['period']}"])
            return v
        y0 = self.year_before(y)
        miss = []
        va, vy = self.get(a, key), self.get(y, key)
        vy0 = self.get(y0, key) if y0 else None
        if va is None:
            miss.append(f"{key} for {a['period']}")
        if vy is None:
            miss.append(f"{key} for {y['period']}")
        if vy0 is None:
            miss.append(f"{key} for the same period a year before {y['period']} (its comparative column)")
        if miss:
            raise Missing(miss)
        return va + vy - vy0

    def ttm_roe(self):
        y = self.ytd() or self.annual()
        y0 = self.year_before(y) or (self.annuals[-2] if len(self.annuals) > 1 and y is self.annual() else None)
        profit = None
        for k in ("netProfitOwners", "netProfit"):
            try:
                profit = self.ttm(k)
                break
            except Missing:
                continue
        e1 = self.raw(y, "totalEquity")
        e0 = self.raw(y0, "totalEquity") if y0 else None
        miss = [x for x, v in ((f"netProfit (twelve months to {y['periodEnd']})", profit),
                               (f"totalEquity at {y['periodEnd']}", e1),
                               ("totalEquity twelve months earlier", e0)) if v is None]
        if miss:
            raise Missing(miss)
        return profit / ((e0 + e1) / 2) * 100

    def annual_get(self, key):
        a = self.annual()
        if key == "cashBeforeInterest":
            return self._cbi(lambda k: self._must(a, k), "annual")
        return self._must(a, key)

    def _must(self, p, key):
        v = self.get(p, key)
        if v is None:
            raise Missing([f"{key} for {p['period']}"])
        return v

    def _cbi(self, getter, label):
        a = self.annual()
        ocf, interest = getter("operatingCashFlow"), getter("interestPaid")
        sec = self.section(a, "interestPaid")
        if sec not in ("operating", "financing"):
            raise Missing([f"the section (operating or financing) of interestPaid for {a['period']}"])
        tax = self._must(a, "taxRate")
        return ocf + interest * (1 - tax / 100) if sec == "operating" else ocf

    def latest(self, key):
        for p in reversed(self.periods):
            v = self.get(p, key)
            if v is not None:
                return v
        raise Missing([key])

    def latest_period(self, key):
        for p in reversed(self.periods):
            if self.get(p, key) is not None:
                return p
        return None

    def quarter_x4(self, key):
        y = self.ytd()
        if y is None:
            raise Missing([f"a quarter after {self.annual()['period']}"])
        if y.get("months") == 3:
            return self._must(y, key) * 4
        q = next((p for p in self.periods if _end(p) == _end(y) and p.get("months") == 3), None)
        if q is not None and self.get(q, key) is not None:
            return self.get(q, key) * 4
        prev = next((p for p in self.periods if p.get("type") != "annual" and p.get("months") == (y.get("months") or 0) - 3
                     and p.get("periodEnd", "") < y["periodEnd"] and p.get("periodEnd", "") > self.annual()["periodEnd"]), None)
        if prev is None:
            raise Missing([f"{key} for the quarter to {y['periodEnd']}"])
        return (self._must(y, key) - self._must(prev, key)) * 4

    def maintenance(self, case):
        import reinvestment
        o = reinvestment.analyse(self.rec.get("ticker"))
        rng = o.get("maintenanceRange") if isinstance(o, dict) else None
        if not rng or rng.get(case) is None:
            raise Missing(["the maintenance capex range (capex, depreciation in the annual periods)"])
        return rng[case]

    def name(self, ref):
        kind, _, key = ref.partition(".")
        if kind == "ttm":
            return self.ttm(key)
        if kind == "annual":
            return self.annual_get(key)
        if kind == "latest":
            return self.latest(key)
        if kind == "quarterX4":
            return self.quarter_x4(key)
        if kind == "maintenance":
            return self.maintenance(key)
        raise KeyError(ref)


def augment(record):
    """A copy of the record with the derived figures added in memory (never saved), for code that
    reads figures from periods (scripts/reinvestment.py): each period's netDebt, taxRate, capexPaid,
    ebitda and freeCashFlow where its report figures allow, and a trailing-twelve-months period."""
    import copy
    out = copy.deepcopy(record)
    rec = Record(out)
    for p in rec.periods:
        figs = p.setdefault("figures", {})
        for key in WORKED_OUT[:-1]:
            if key in figs and key not in ("capexPaid",):
                continue
            v = rec.get(p, key)
            if v is not None and not (key == "capexPaid" and key in figs):
                figs[key] = {"value": round(v, 2 if key == "taxRate" else 4), "unit": "%" if key == "taxRate" else "Rs bn",
                             "source": f"derived.py ({key})"}
    try:
        y = rec.ytd()
    except Missing:
        y = None
    if y is not None:
        ttm = {"period": f"TTM {y['periodEnd']}", "periodEnd": y["periodEnd"], "months": 12, "type": "interim",
               "derived": True, "figures": {}}
        for key in FLOWS + ("roe", "ebitda", "freeCashFlow"):
            try:
                v = rec.ttm(key)
            except Missing:
                continue
            unit = "Rs" if key == "eps" else "%" if key == "roe" else "Rs bn"
            ttm["figures"][key] = {"value": round(v, 4), "unit": unit, "source": "derived.py (trailing twelve months)"}
        sec = rec.section(rec.annual(), "interestPaid")
        if "interestPaid" in ttm["figures"] and sec:
            ttm["figures"]["interestPaid"]["section"] = sec
        out["periods"] = rec.periods + [ttm]
    return out


# ---- expressions in modelInputs.derive ----
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def evaluate(expr, rec, siblings=None):
    """Evaluates 'ttm.operatingProfit * (1 - annual.taxRate / 100)'. Returns (value, literals used)."""
    literals = []

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.USub):
            return -ev(n.operand)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            if n.value not in (1, 100):          # 1 and 100 are unit conversions, not assumptions
                literals.append(n.value)
            return float(n.value)
        if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name):
            return rec.name(f"{n.value.id}.{n.attr}")
        if isinstance(n, ast.Name) and siblings is not None and isinstance(siblings.get(n.id), (int, float)):
            return float(siblings[n.id])
        raise ValueError(f"can't evaluate {ast.dump(n)[:60]} in '{expr}'")

    return ev(ast.parse(expr, mode="eval")), literals


def _set(obj, path, value):
    parts = path.split(".")
    for k in parts[:-1]:
        obj = obj[k]
    obj[parts[-1]] = value


def _getp(obj, path):
    for k in path.split("."):
        obj = obj[k]
    return obj


def resolve(data, record):
    """{path: (value, spec)} for every modelInputs.derive entry; raises Missing with everything missing."""
    import copy
    mi = copy.deepcopy(data.get("modelInputs") or {})   # filled in as we go, so later entries use earlier ones
    spec = mi.get("derive") or {}
    rec = Record(record)
    out, missing, problems = {}, [], []
    names = {v.get("name") for v in record.get("valuationInputs") or []}
    for path, s in spec.items():
        calc = s["calc"] if isinstance(s, dict) else s
        parent = path.rsplit(".", 1)[0]
        try:
            sib = _getp(mi, parent) if "." in path else mi
        except (KeyError, TypeError):
            problems.append(f"{path}: no such field in modelInputs")
            continue
        try:
            v, lits = evaluate(calc, rec, sib if isinstance(sib, dict) else None)
        except Missing as e:
            missing += [f"{m} (for {path})" for m in e.args[0]]
            continue
        except ValueError as e:
            problems.append(f"{path}: {e}")
            continue
        basis = s.get("basis") if isinstance(s, dict) else None
        if lits and not (basis and str(basis).startswith("valuationInputs: ") and basis.split(": ", 1)[1] in names):
            problems.append(f"{path}: '{calc}' uses assumption(s) {lits} without a basis naming a valuationInputs entry")
        out[path] = (round(v, 4), calc)
        _set(mi, path, round(v, 3))
    return out, missing, problems


def report(code):
    t = code if "." in code else f"{code}.N0000"
    record = json.loads((RESEARCH / t / "record.json").read_text(encoding="utf-8"))
    rec = Record(record)
    a, y = rec.annual(), rec.ytd()
    print(f"{t}: latest annual {a['period']}; year to date {y['period'] if y else '(none after it)'}"
          + (f"; comparative {rec.year_before(y)['period'] if y and rec.year_before(y) else 'MISSING'}" if y else ""))
    rows = [("ttm." + k) for k in ("revenue", "operatingProfit", "netProfit", "eps", "operatingCashFlow", "interestPaid",
                                   "capexPaid", "depreciationAmortisation", "ebitda", "freeCashFlow", "cashBeforeInterest", "roe")]
    rows += ["annual.taxRate", "annual.cashBeforeInterest", "latest.netDebt", "latest.navPerShare", "latest.sharesOutstanding",
             "quarterX4.eps", "maintenance.bear", "maintenance.base", "maintenance.bull"]
    missing = []
    for r in rows:
        try:
            print(f"  {r:28} {rec.name(r):12.4f}")
        except Missing as e:
            missing += e.args[0]
            print(f"  {r:28} {'missing':>12}  ({'; '.join(e.args[0])})")
    worked = [f"{p['period']} {k}" for p in rec.periods for k, f in (p.get("figures") or {}).items()
              if isinstance(f, dict) and "worked out" in f"{f.get('source', '')} {f.get('note', '')}".lower()]
    if worked:
        print("  Worked-out figures still stored in the record (replace with the report figures):", ", ".join(worked))
    return missing


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 1
    code = args[0]
    t = code if "." in code else f"{code}.N0000"
    report(t)
    if "--write" in sys.argv:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from common import write_json
        p = DATA / f"{t}.json"
        data = json.loads(p.read_text(encoding="utf-8"))
        record = json.loads((RESEARCH / t / "record.json").read_text(encoding="utf-8"))
        vals, missing, problems = resolve(data, record)
        for x in missing + problems:
            print("  !", x)
        if missing or problems:
            print("Nothing written.")
            return 1
        for path, (v, calc) in vals.items():
            old = _getp(data["modelInputs"], path)
            _set(data["modelInputs"], path, round(v, 3))
            print(f"  {path:22} {old!s:>9} → {round(v, 3):<9} = {calc}")
        write_json(p, data)
        print(f"Filled {len(vals)} modelInputs fields in data/{t}.json. Now run scripts/valuation.py {t} --write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
