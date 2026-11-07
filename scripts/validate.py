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
]
CORE = {"schemaVersion", "ticker", "analysisDate"}


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


CHECKERS = {
    "company": chk_company, "shareClasses": chk_share_classes, "resultsCovered": chk_results,
    "price": chk_price, "summary": chk_summary, "valuation": chk_valuation,
    "keyMetrics": chk_metrics, "highlights": chk_titled_list, "history": chk_history,
    "methodReadings": chk_readings, "models": chk_models, "modelsNote": chk_text,
    "scenarios": chk_scenarios, "sensitivity": chk_sensitivity, "buyPlan": chk_buyplan,
    "changeMyView": chk_cmv, "notes": chk_notes, "fullText": chk_text,
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
    for key in data:
        if key not in CORE and key not in CHECKERS:
            warnings.append(f"Unknown section '{key}' (shown under 'Other details').")
    return data, errors, warnings, bad


def main(paths):
    failed = False
    for path in paths:
        data, errors, warnings, _ = validate_text(Path(path).read_text(encoding="utf-8"), path)
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
