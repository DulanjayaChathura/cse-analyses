"""Small client for the Colombo Stock Exchange website's data feed.

The CSE has no official public API. These are the unofficial endpoints the
cse.lk website itself uses; they can change without notice. Every caller
treats a failure as "keep the last known data and warn".
"""
import datetime
import json
import time
import urllib.parse
import urllib.request

BASE = "https://www.cse.lk/api/"
LOGO_BASE = "https://cdn.cse.lk/cmt/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; personal-analysis-site/1.0)",
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://www.cse.lk",
    "Referer": "https://www.cse.lk/",
}
COLOMBO = datetime.timezone(datetime.timedelta(hours=5, minutes=30))


def today_colombo():
    return datetime.datetime.now(COLOMBO).date().isoformat()


MARKET_CLOSE = datetime.time(14, 30)


def last_session_date(now=None):
    """Date of the most recent CSE trading session that has closed.

    Weekends roll back to Friday; before 14:30 on a weekday the latest closed
    session is the previous weekday. Public holidays aren't known here, so
    callers also prefer a trade date reported by the CSE itself when present.
    """
    now = now or datetime.datetime.now(COLOMBO)
    d = now.date()
    if now.weekday() < 5 and now.time() < MARKET_CLOSE:
        d -= datetime.timedelta(days=1)
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    return d.isoformat()


def date_from_cse(value):
    """Turn a CSE timestamp (epoch milliseconds) into a Colombo date, or None."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v < 1e12:  # not epoch milliseconds
        return None
    return datetime.datetime.fromtimestamp(v / 1000, COLOMBO).date().isoformat()


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def post(endpoint, data=None, retries=2):
    body = urllib.parse.urlencode(data or {}).encode()
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(BASE + endpoint, data=body, headers=HEADERS, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # network error, HTTP error, bad JSON
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"CSE request '{endpoint}' failed: {last}")


def download(url, retries=2):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"], "Referer": "https://www.cse.lk/"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read(), r.headers.get("Content-Type", "")
        except Exception as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Download failed for {url}: {last}")


def company_info(symbol):
    """Return (name, logo_path, last_traded_price, previous_close) for one symbol."""
    d = post("companyInfoSummery", {"symbol": symbol})
    info = d.get("reqSymbolInfo") or {}
    logo = (d.get("reqLogo") or {}).get("path")
    return info.get("name"), logo, info.get("lastTradedPrice"), info.get("previousClose")


def trade_summary():
    """Return {symbol: row} for every security in today's trade summary."""
    d = post("tradeSummary")
    rows = d.get("reqTradeSummery") or []
    return {r.get("symbol"): r for r in rows if isinstance(r, dict) and r.get("symbol")}


SMALL_WORDS = {"PLC", "LTD", "CO", "&"}


def nice_name(name):
    """'DIALOG AXIATA PLC' -> 'Dialog Axiata PLC'; 'C I C HOLDINGS PLC' -> 'CIC Holdings PLC'."""
    if not name:
        return name
    words, run = [], ""
    for w in name.split():
        if len(w) == 1 and w.isalpha():      # spaced initials: C I C
            run += w
            continue
        if run:
            words.append((run, True)); run = ""
        words.append((w, False))
    if run:
        words.append((run, True))
    out = []
    for w, initials in words:
        core = w.strip("()&.,")
        if initials or w.upper() in SMALL_WORDS or (core.isalpha() and not any(c in "AEIOU" for c in core.upper())):
            out.append(w.upper() if w.upper() != "CO" else "Co")      # PLC, LTD, HNB, NDB, CIC
        else:
            i = next((k for k, c in enumerate(w) if c.isalpha()), 0)
            out.append(w[:i] + w[i].upper() + w[i + 1:].lower())
    return " ".join(out)
