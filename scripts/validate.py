"""Check analysis files in data/.

ERRORS reject the file (the site keeps the previous valid version).
WARNINGS accept the file; the affected section shows "Not available".

Run locally:  python scripts/validate.py data/DIAL.N0000.json
"""
import datetime
import json
import re
import sys
from pathlib import Path

SCHEMA_VERSION = 1
TICKER_RE = re.compile(r"^[A-Z0-9]+\.[A-Z]\d{4}$")
VERDICTS = {"strong-buy", "buy", "fair", "overpriced"}
UNITS = {"Rs", "Rs bn", "Rs mn", "x", "%", ""}

KNOWN_SECTIONS = [
    "company", "shareClasses", "resultsCovered", "price", "summary", "valuation",
    "keyMetrics", "highlights", "history", "methodReadings", "models", "modelsNote",
    "scenarios", "sensitivity", "buyPlan", "changeMyView", "notes", "fullText",
    "quality", "dividend",
]
CORE = {"schemaVersion", "ticker", "analysisDate"}

# Sections from the new research framework. Until the site has its own layout
# for them, they are shown under "Other details" without raising a warning.
FRAMEWORK_SECTIONS = {
    "Decision box", "Business and moat", "Management and governance", "Accounting quality",
    "Peer and history comparison", "Sri Lanka checks", "Crisis stress test (2022-style)",
    "Portfolio fit", "Broker view", "Investment case and sell rules",
    "Suggested Telegram alerts (not set; needs your approval)", "Key ratios (five-year trend)",
    "What this analysis doesn't cover",
}


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_num_or_null(v):
    return v is None or is_num(v)


def is_date(v):
    if not isinstance(v, str):
        return False
    try:
        datetime.date.fromisoformat(v)
        return True
    except ValueError:
        return False


def is_str(v):
    return isinstance(v, str) and v.strip() != ""


# Each checker returns a list of problems (empty list = section is fine).
def chk_company(s):
    p = []
    if not isinstance(s, dict):
        return ["must be an object"]
    if "fiscalYearEnd" in s and not (isinstance(s["fiscalYearEnd"], str) and re.match(r"^\d{2}-\d{2}$", s["fiscalYearEnd"])):
        p.append('fiscalYearEnd must look like "12-31"')
    return p


def chk_share_classes(s):
    if not isinstance(s, list) or not s:
        return ["must be a non-empty list"]
    p = []
    for i, c in enumerate(s):
        if not isinstance(c, dict) or not isinstance(c.get("symbol"), str) or not TICKER_RE.match(c["symbol"]):
            p.append(f"item {i + 1}: symbol must look like DIAL.N0000")
    return p


def chk_results(s):
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    if not is_date(s.get("periodEnd")):
        p.append("periodEnd must be a YYYY-MM-DD date")
    return p


def chk_price(s):
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    if not is_num(s.get("value")):
        p.append("value must be a number")
    if not is_date(s.get("date")):
        p.append("date must be a YYYY-MM-DD date")
    return p


def chk_summary(s):
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    if not is_str(s.get("text")) and not is_str(s.get("headline")):
        p.append("needs text or headline")
    if "verdict" in s and s["verdict"] not in VERDICTS:
        p.append(f"verdict must be one of {sorted(VERDICTS)}")
    return p


def chk_valuation(s):
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    for k in ("fairValue", "buyPrice", "strongBuyPrice"):
        if not is_num(s.get(k)):
            p.append(f"{k} must be a number")
    return p


def chk_metrics(s):
    if not isinstance(s, list):
        return ["must be a list"]
    p = []
    for i, m in enumerate(s):
        if not isinstance(m, dict) or not is_str(m.get("label")):
            p.append(f"item {i + 1}: needs a label")
            continue
        if not is_num_or_null(m.get("value")) and not is_str(m.get("display")):
            p.append(f'"{m["label"]}": value must be a number (or give a display text)')
        if m.get("unit", "") not in UNITS:
            p.append(f'"{m["label"]}": unit must be one of {sorted(UNITS)}')
    return p


def chk_titled_list(s):
    if not isinstance(s, list):
        return ["must be a list"]
    return [f"item {i + 1}: needs text" for i, h in enumerate(s) if not isinstance(h, dict) or not is_str(h.get("text"))]


def chk_history(s):
    if not isinstance(s, dict) or not isinstance(s.get("periods"), list) or not isinstance(s.get("series"), list):
        return ["needs periods and series lists"]
    n = len(s["periods"])
    p = []
    for se in s["series"]:
        label = se.get("label", "?") if isinstance(se, dict) else "?"
        vals = se.get("values") if isinstance(se, dict) else None
        if not isinstance(vals, list) or len(vals) != n:
            p.append(f'"{label}": values must have {n} entries, one per period')
        elif not all(is_num_or_null(v) for v in vals):
            p.append(f'"{label}": values must be numbers or null')
        notes = se.get("notes") if isinstance(se, dict) else None
        if notes is not None and (not isinstance(notes, list) or len(notes) != n):
            p.append(f'"{label}": notes must have {n} entries')
    return p


def chk_readings(s):
    if not isinstance(s, list):
        return ["must be a list"]
    return [f"item {i + 1}: needs method and reading" for i, r in enumerate(s)
            if not isinstance(r, dict) or not is_str(r.get("method")) or not is_str(r.get("reading"))]


def chk_models(s):
    if not isinstance(s, list) or not s:
        return ["must be a non-empty list"]
    p = []
    for i, m in enumerate(s):
        if not isinstance(m, dict) or not is_str(m.get("name")):
            p.append(f"item {i + 1}: needs a name")
            continue
        for k in ("bear", "base", "bull"):
            if not is_num(m.get(k)):
                p.append(f'"{m["name"]}": {k} must be a number')
        if not is_num_or_null(m.get("weighted")):
            p.append(f'"{m["name"]}": weighted must be a number')
    return p


def chk_text(s):
    return [] if is_str(s) else ["must be text"]


def chk_scenarios(s):
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    a = s.get("assumptions")
    if a is not None and (not isinstance(a, list) or not all(isinstance(x, dict) and is_str(x.get("label")) for x in a)):
        p.append("assumptions must be a list of {label, bear, base, bull}")
    av = s.get("averages")
    if av is not None and (not isinstance(av, dict) or not all(is_num_or_null(av.get(k)) for k in ("bear", "base", "bull"))):
        p.append("averages must have numeric bear, base and bull")
    return p


def chk_sensitivity(s):
    if not isinstance(s, dict):
        return ["must be an object"]
    rows, cols, vals = s.get("rows"), s.get("columns"), s.get("values")
    if not isinstance(rows, list) or not isinstance(cols, list) or not isinstance(vals, list):
        return ["needs rows, columns and values lists"]
    if len(vals) != len(rows) or not all(isinstance(r, list) and len(r) == len(cols) and all(is_num_or_null(v) for v in r) for r in vals):
        return [f"values must be {len(rows)} rows of {len(cols)} numbers"]
    return []


def chk_buyplan(s):
    if not isinstance(s, dict) or not isinstance(s.get("tiers"), list):
        return ["needs a tiers list"]
    return [f"tier {i + 1}: shares and maxPrice must be numbers" for i, t in enumerate(s["tiers"])
            if not isinstance(t, dict) or not is_num(t.get("shares")) or not is_num(t.get("maxPrice"))]


def chk_cmv(s):
    if not isinstance(s, dict):
        return ["must be an object"]
    return [f"{k} must be a list of text" for k in ("higher", "lower")
            if k in s and not (isinstance(s[k], list) and all(isinstance(x, str) for x in s[k]))]


def chk_notes(s):
    return [] if isinstance(s, dict) else ["must be an object"]


def chk_quality(s):
    """Business tests behind the category shown on the site (see docs/json-format.md)."""
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    if s.get("rating") not in ("good", "weak"):
        p.append('rating must be "good" or "weak"')
    tests = s.get("tests")
    if not isinstance(tests, list) or not tests:
        p.append("tests must be a non-empty list")
    else:
        for i, t in enumerate(tests):
            if not isinstance(t, dict) or not is_str(t.get("label")) or not isinstance(t.get("pass"), bool):
                p.append(f"test {i + 1}: needs a label and pass (true or false)")
        if not p and s.get("rating") == "good" and sum(t["pass"] for t in tests) < 3:
            p.append('rating "good" needs at least 3 tests passed')
    return p


def chk_dividend(s):
    """Latest dividend per share, shown on the home-page card (see docs/json-format.md)."""
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    for name, d in (("dividend", s), ("latest", s.get("latest"))):
        if d is None and name == "latest":
            continue
        if not isinstance(d, dict):
            p.append(f"{name} must be an object")
            continue
        if not is_num_or_null(d.get("perShare")) or (is_num(d.get("perShare")) and d["perShare"] < 0):
            p.append(f"{name}: perShare must be a number of rupees (0 or more) or null")
        if not is_str(d.get("label")):
            p.append(f'{name}: label is needed, e.g. "for 2025/26"')
    return p


def chk_required_return(s):
    """Beta, cost of equity and WACC, shown as the "Required return" tile (see docs/json-format.md)."""
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    for k in ("beta", "riskFree", "matureERP", "countryPremium"):
        if not is_num(s.get(k)):
            p.append(f"{k} must be a number")
    for k, need in (("costOfEquity", True), ("wacc", False)):
        v = s.get(k)
        if v is None and not need:
            continue
        if not isinstance(v, dict) or not all(is_num(v.get(c)) for c in ("bear", "base", "bull")):
            p.append(f"{k} must be {{bear, base, bull}} numbers" + ("" if need else " or null"))
    if is_num(s.get("beta")) and not 0.3 <= s["beta"] <= 2:
        p.append("beta outside 0.3-2: explain it in betaBasis") if not is_str(s.get("betaBasis")) else None
    w, c = s.get("wacc"), s.get("costOfEquity")
    if isinstance(w, dict) and isinstance(c, dict) and is_num(w.get("base")) and is_num(c.get("base")) and w["base"] > c["base"]:
        p.append("WACC above the cost of equity: check the cost of debt")
    if not is_date(s.get("asOf")):
        p.append("asOf must be a YYYY-MM-DD date")
    return p


def chk_model_inputs(s):
    """The numbers behind each adjustable method, used by the "What if?" panel (docs/json-format.md)."""
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    ke = s.get("costOfEquity")
    if not isinstance(ke, dict) or not all(is_num(ke.get(c)) for c in ("bear", "base", "bull")):
        p.append("costOfEquity must be {bear, base, bull} numbers")
    if "dcf" in s:
        for k in ("shares", "netDebt"):
            if not is_num(s.get(k)):
                p.append(f"{k} must be a number when there's a DCF")
        w = s.get("wacc")
        if not isinstance(w, dict) or not all(is_num(w.get(c)) for c in ("bear", "base", "bull")):
            p.append("wacc must be {bear, base, bull} numbers when there's a DCF")
    add = (s.get("dcf") or {}).get("addOn") if isinstance(s.get("dcf"), dict) else None
    if add is not None and not (isinstance(add, dict) and all(is_num(add.get(c)) for c in ("bear", "base", "bull"))):
        p.append("dcf.addOn must be {bear, base, bull} numbers (Rs a share)")
    for mid in ("dcf", "pe", "ddm", "ri", "pb"):
        m = s.get(mid)
        if m is not None and not (isinstance(m, dict) and all(isinstance(m.get(c), dict) for c in ("bear", "base", "bull"))):
            p.append(f"{mid} needs bear, base and bull inputs")
    return p


def model_soundness(mi):
    """Checks against the formula sources listed in scripts/valuation.py (Damodaran, CFA Institute)."""
    out = []
    market = json.loads((Path(__file__).resolve().parent.parent / "research" / "market-inputs.json").read_text(encoding="utf-8"))
    bond = (market.get("bondYield10y") or {}).get("value")
    ke = mi.get("costOfEquity") or {}
    for mid in ("dcf", "pe", "ddm", "ri", "pb"):
        m = mi.get(mid)
        if not isinstance(m, dict):
            continue
        for c in ("bear", "base", "bull"):
            x = m.get(c) or {}
            gl = x.get("longRun")
            if is_num(gl) and is_num(bond) and gl >= bond:
                out.append(f"{mid} {c}: long-run growth {gl}% isn't below the {bond}% 10-year bond rate.")
            if mid == "ddm":
                if x.get("eps") is None or x.get("roe") is None:
                    out.append(f"ddm {c}: no eps and roe, so after year {m.get('years', 5)} the dividend keeps the "
                               "high-growth payout; Damodaran's stable payout is 1 − g ÷ ROE. Add them and redo.")
                elif is_num(gl) and is_num(x.get("roe")) and x["roe"] <= gl:
                    out.append(f"ddm {c}: long-run ROE {x['roe']}% must be above long-run growth {gl}%.")
            if mid == "dcf" and is_num(x.get("stableRoc")) and is_num((mi.get("wacc") or {}).get(c)) and x["stableRoc"] < mi["wacc"][c]:
                out.append(f"dcf {c}: return on capital after year 5 ({x['stableRoc']}%) is below WACC; growth would then destroy value.")
    return out


MG_STATUS = ("done", "on-track", "missed", "too-early")


def chk_management(s):
    """Management and plans box in the Overview (see docs/json-format.md)."""
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    if not is_str(s.get("source")):
        p.append("source must name the report and pages")
    for k in ("said", "plans", "investing"):
        items = s.get(k)
        if items is None:
            continue
        if not isinstance(items, list) or not all(isinstance(x, dict) and is_str(x.get("text")) for x in items):
            p.append(f"{k} must be a list of {{text, ref}}")
        elif len(items) > 5:
            p.append(f"{k} has {len(items)} points; keep it to 5 at most")
    t = s.get("track")
    if t is not None:
        if not isinstance(t, list) or not all(isinstance(x, dict) and is_str(x.get("promise")) and x.get("status") in MG_STATUS for x in t):
            p.append("track must be a list of {promise, result, status: " + " / ".join(MG_STATUS) + ", ref}")
        elif len(t) > 6:
            p.append(f"track has {len(t)} points; keep it to 6 at most")
    return p


def chk_shareholders(s):
    """Shareholders section (see docs/json-format.md)."""
    if not isinstance(s, dict):
        return ["must be an object"]
    p = []
    if not is_date(s.get("asOf")):
        p.append("asOf must be a YYYY-MM-DD date")
    if not is_str(s.get("source")):
        p.append("source must name the report and page")
    top = s.get("top")
    if not isinstance(top, list) or not top or not all(isinstance(x, dict) and is_str(x.get("name")) and is_num(x.get("pct")) and is_num(x.get("shares")) for x in top):
        p.append("top must be a list of {name, shares, pct, change}")
    elif len(top) > 20:
        p.append("top has more than 20 holders")
    g = s.get("groups")
    if g is not None and (not isinstance(g, list) or not all(is_num(x.get("pct")) for x in g) or sum(x["pct"] for x in g) > 100.5):
        p.append("groups must be {name, pct} adding up to no more than 100%")
    if not is_num(s.get("publicFloat")):
        p.append("publicFloat must be a number")
    if not is_num(s.get("publicHolders")):
        p.append("publicHolders must be a number")
    return p


# Checked when present; no warning when missing (older analyses predate them).
OPTIONAL_SECTIONS = {"requiredReturn": chk_required_return, "modelInputs": chk_model_inputs, "management": chk_management, "shareholders": chk_shareholders}

CHECKERS = {
    "company": chk_company, "shareClasses": chk_share_classes, "resultsCovered": chk_results,
    "price": chk_price, "summary": chk_summary, "valuation": chk_valuation,
    "keyMetrics": chk_metrics, "highlights": chk_titled_list, "history": chk_history,
    "methodReadings": chk_readings, "models": chk_models, "modelsNote": chk_text,
    "scenarios": chk_scenarios, "sensitivity": chk_sensitivity, "buyPlan": chk_buyplan,
    "changeMyView": chk_cmv, "notes": chk_notes, "fullText": chk_text,
    "quality": chk_quality, "dividend": chk_dividend,
}


def validate_text(text, filename):
    """Return (data or None, errors, warnings, bad_sections)."""
    errors, warnings, bad = [], [], []
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return None, [f"Not valid JSON (line {e.lineno}, column {e.colno}): {e.msg}"], [], []
    if not isinstance(data, dict):
        return None, ["The file must contain a JSON object { ... }"], [], []

    expected = Path(filename).stem
    if data.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"schemaVersion must be {SCHEMA_VERSION} (found {data.get('schemaVersion')!r})")
    t = data.get("ticker")
    if not isinstance(t, str) or not TICKER_RE.match(t):
        errors.append('ticker must look like "DIAL.N0000"')
    elif t != expected:
        errors.append(f'ticker "{t}" does not match the filename "{expected}.json"')
    if not is_date(data.get("analysisDate")):
        errors.append("analysisDate must be a YYYY-MM-DD date")
    if errors:
        return None, errors, [], []

    for key in KNOWN_SECTIONS:
        if key not in data:
            warnings.append(f"Section '{key}' is missing (shown as not available).")
            continue
        problems = CHECKERS[key](data[key])
        if problems:
            bad.append(key)
            warnings.append(f"Section '{key}' has problems and will be shown as not available: " + "; ".join(problems[:5]))
    for key, check in OPTIONAL_SECTIONS.items():
        if key in data:
            problems = check(data[key])
            if problems:
                bad.append(key)
                warnings.append(f"Section '{key}' has problems and will be shown as not available: " + "; ".join(problems[:5]))
    if "modelInputs" in data and "modelInputs" not in bad:
        import valuation  # same folder
        diffs = valuation.mismatches(data)
        if diffs:
            bad.append("modelInputs")
            warnings.append("Section 'modelInputs' doesn't reproduce the published values, so the What if? panel is hidden: "
                            + "; ".join(diffs[:4]) + " (run scripts/valuation.py CODE inputs.json --write).")
    if isinstance(data.get("modelInputs"), dict) and "modelInputs" not in bad:
        warnings += [f"modelInputs: {w}" for w in model_soundness(data["modelInputs"])]
    for key in data:
        if key not in CORE and key not in CHECKERS and key not in OPTIONAL_SECTIONS and key not in FRAMEWORK_SECTIONS:
            warnings.append(f"Unknown section '{key}' (shown under 'Other details').")
    return data, errors, warnings, bad


def record_warnings(data):
    """Checks on research/<CODE>/record.json (command line only; the site build doesn't use them).
    A figure recorded as null with a note (e.g. "not disclosed") counts as recorded."""
    from reinvestment import ALIASES, FINANCIAL_WORDS
    ticker = data.get("ticker")
    path = Path(__file__).resolve().parent.parent / "research" / str(ticker) / "record.json"
    if not path.exists():
        return [f"No research record at research/{ticker}/record.json."]
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"Research record is not valid JSON (line {e.lineno}): {e.msg}"]
    out = []
    sector = ((data.get("company") or {}).get("sector") or "").lower()
    annuals = sorted([p for p in record.get("periods") or [] if p.get("type") == "annual"],
                     key=lambda p: p.get("periodEnd") or "")
    if annuals and not any(w in sector for w in FINANCIAL_WORDS):
        figs = annuals[-1].get("figures") or {}
        for key, label in (("capex", "capex"), ("depreciation", "depreciation")):
            if not any(name in figs for name in ALIASES[key]):
                out.append(f"Research record: {label} missing for {annuals[-1].get('period')} "
                           "(record it from the annual report, or null with a note if not disclosed).")
    names = {(v.get("name") or "").lower() for v in record.get("valuationInputs") or []}
    if "growth check" not in names:
        out.append("Research record: no 'Growth check' valuation input (run scripts/reinvestment.py).")
    if "beta" not in names:
        out.append("Research record: no 'Beta' valuation input (the 8 steps in CLAUDE.md, 'Required return and the DCF').")
    financial = any(w in sector for w in FINANCIAL_WORDS)
    if annuals and not financial:
        f = (annuals[-1].get("figures") or {}).get("interestPaid")
        if f is None:
            out.append(f"Research record: interestPaid missing for {annuals[-1].get('period')} (needed for WACC and the DCF).")
        elif f.get("section") not in ("operating", "financing"):
            out.append("Research record: interestPaid needs \"section\": \"operating\" or \"financing\".")
    # Every modelInputs `basis` must point at something stored in the record (no unrecorded assumptions).
    names = {v.get("name") for v in record.get("valuationInputs") or []}
    periods = {(p.get("period"), k) for p in record.get("periods") or [] for k in (p.get("figures") or {})}
    for mid, m in (data.get("modelInputs") or {}).items():
        if not isinstance(m, dict) or not isinstance(m.get("basis"), dict):
            continue
        for field, ref in m["basis"].items():
            kind, _, what = str(ref).partition(": ")
            ok = (kind == "valuationInputs" and what in names) or \
                 (kind == "periods" and tuple(what.rsplit(".", 1)) in periods)
            if not ok:
                out.append(f"modelInputs.{mid}.basis.{field} points at '{ref}', which isn't in the research record.")
    ddm = (data.get("modelInputs") or {}).get("ddm")
    if isinstance(ddm, dict) and not isinstance(ddm.get("basis"), dict):
        out.append("modelInputs.ddm has no basis: name the record entries its eps and roe come from.")
    rr = data.get("requiredReturn")
    if rr is None:
        out.append("No 'requiredReturn' section (beta, cost of equity, WACC): copy it from scripts/reinvestment.py.")
    elif any(m.get("id") == "dcf" for m in data.get("models") or [] if isinstance(m, dict)) and not financial and not rr.get("wacc"):
        out.append("The DCF needs WACC in 'requiredReturn' (whole-company DCF: WACC, minus net debt).")
    return out


def main(paths):
    failed = False
    for path in paths:
        data, errors, warnings, _ = validate_text(Path(path).read_text(encoding="utf-8"), path)
        if data is not None:
            warnings = warnings + record_warnings(data)
        status = "REJECTED" if errors else ("OK with warnings" if warnings else "OK")
        print(f"{path}: {status}")
        for e in errors:
            print(f"  ERROR: {e}")
        for w in warnings:
            print(f"  warning: {w}")
        failed = failed or bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or sorted(str(p) for p in Path("data").glob("*.json"))))
