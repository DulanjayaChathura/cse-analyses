"""Keep the 10-year government bond yield in research/market-inputs.json up to date.

Run by .github/workflows/bond-rate.yml every Monday, with a retry on Tuesday. No Claude needed.

1. Read the Public Debt Management Office's list of daily "Government Securities Secondary
   Market Trade Summary" reports on the Treasury website.
2. Starting from the newest report, read the table of bonds traded that day and take the ones
   with 9 to 11 years left (if none traded within a week, 8 to 12 years). The rate is their
   weighted average yield, weighted by the amount traded.
3. If it differs from the saved figure by MIN_MOVE points or more, overwrite the figure and post
   it to Telegram. Otherwise change nothing.

The PDFs are read in a temporary folder and never saved.

  python scripts/bond_rate.py --dry-run     print what it reads, change nothing
  python scripts/bond_rate.py               update the file if the rate moved
  python scripts/bond_rate.py --warn        also post to Telegram if it couldn't get a rate
"""
import argparse
import datetime as dt
import html as htmllib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, read_json, write_json  # noqa: E402

MARKET = ROOT / "research" / "market-inputs.json"
SITE = "https://www.treasury.gov.lk"
LIST = SITE + "/web/reports-secondary-market-trade-summary/section/{year}"
MIN_MOVE = 0.25          # points; smaller moves leave the file alone
LOOK_BACK_DAYS = 7       # how far back from the newest report to look for a usable trade
STALE_DAYS = 10          # newest report older than this means something is wrong
RANGES = [(9.0, 11.0), (8.0, 12.0)]
UA = {"User-Agent": "Mozilla/5.0 (cse-analyses bond-rate check; GitHub Actions)"}
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july",
                                       "august", "september", "october", "november", "december"], 1)}

# One table row: No, ISIN, tenure, type, opening, closing, highest, lowest, weighted average, volume, trades.
ROW = re.compile(
    r"(LK[AB][0-9A-Z]{9})\s+(\d+\.\d+)\s+(T\s?Bond|T\s?bill|TBill)\s+"
    r"(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+([\d,]+(?:\.\d+)?)\s+(\d+)", re.I)


class NoRate(Exception):
    """Couldn't get a usable rate (site down, no reports, no trades)."""


def get(url, timeout=60):
    url = url.replace("http://", "https://", 1)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def list_reports(today):
    """[(trade date, url)], newest first, from this year's and last year's list pages."""
    found = {}
    errors = []
    for year in (today.year, today.year - 1):
        try:
            page = get(LIST.format(year=year)).decode("utf-8", "replace")
        except Exception as e:
            errors.append(f"{year}: {e}")
            continue
        page = htmllib.unescape(page.replace('\\"', '"').replace("\\/", "/"))
        # Each link: .../api/file/<id>" ... "Trade Summary - 19 November 2026", before the next link.
        parts = re.split(r"(api/file/[0-9a-f-]{36})", page)
        for i in range(1, len(parts) - 1, 2):
            text = re.sub(r"<[^>]+>", " ", parts[i + 1][:1500])
            m = re.search(r"Trade\s+Summary\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", text)
            if not m or m.group(2).lower() not in MONTHS:
                continue
            d = dt.date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
            found.setdefault(d, f"{SITE}/{parts[i]}")
        if found:
            break  # this year's page had reports; last year's only matters in early January
    if not found:
        raise NoRate("couldn't read the list of reports" + (f" ({'; '.join(errors)})" if errors else ""))
    return sorted(found.items(), reverse=True)


def pdf_text(data):
    """The report's text, with the table's columns kept apart."""
    with tempfile.TemporaryDirectory() as tmp:  # deleted when done: nothing is kept
        pdf = Path(tmp) / "report.pdf"
        pdf.write_bytes(data)
        if shutil.which("pdftotext"):
            out = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True)
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout
        try:
            from pypdf import PdfReader
        except ImportError:
            raise NoRate("no PDF reader available (install poppler-utils or pypdf)")
        return "\n".join(p.extract_text() or "" for p in PdfReader(str(pdf)).pages)


def bonds_in(text):
    rows = []
    for m in ROW.finditer(text):
        if "bond" not in m.group(3).lower():
            continue
        rows.append({"isin": m.group(1), "years": float(m.group(2)), "closing": float(m.group(5)),
                     "yield": float(m.group(8)), "volume": float(m.group(9).replace(",", "")), "trades": int(m.group(10))})
    return rows


def find_rate(reports, log=print):
    newest = reports[0][0]
    window = [(d, u) for d, u in reports if (newest - d).days <= LOOK_BACK_DAYS]
    read = {}
    for lo, hi in RANGES:
        for d, url in window:
            if d not in read:
                try:
                    text = pdf_text(get(url))
                except NoRate:
                    raise
                except Exception as e:
                    log(f"  {d}: couldn't download or read ({e})")
                    read[d] = None
                    continue
                read[d] = bonds_in(text)
                log(f"  {d}: {len(read[d])} bonds in the table  {url}")
                for b in read[d]:
                    log(f"      {b['isin']}  {b['years']:5.2f} years  yield {b['yield']:.2f}%  Rs {b['volume']:,.0f} Mn")
            use = [b for b in (read[d] or []) if lo <= b["years"] <= hi and b["volume"] > 0]
            if use:
                vol = sum(b["volume"] for b in use)
                rate = round(sum(b["yield"] * b["volume"] for b in use) / vol, 2)
                return {"value": rate, "date": d.isoformat(), "url": url, "range": [lo, hi], "bonds": use}
        log(f"  no bonds with {lo:g}-{hi:g} years left traded in the week to {newest}")
    raise NoRate(f"no bonds with 8-12 years left traded in the week to {newest:%d %b %Y}")


def fmt_date(iso):
    return dt.date.fromisoformat(iso).strftime("%-d %b %Y")


def telegram(text):
    import telegram as tg
    if not tg.configured():
        print("(Telegram not configured; message not sent)\n" + text)
        return
    tg.call("sendMessage", {"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": text, "parse_mode": "HTML",
                            "disable_web_page_preview": "true"})


def output(**kv):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as f:
            for k, v in kv.items():
                f.write(f"{k}={v}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="print what it reads; change nothing, send nothing")
    ap.add_argument("--warn", action="store_true", help="post to Telegram if no rate could be found")
    a = ap.parse_args()

    market = read_json(MARKET, None)
    if not market or "bondYield10y" not in market:
        sys.exit(f"{MARKET} has no bondYield10y entry")
    saved = market["bondYield10y"]
    today = dt.date.today()
    try:
        reports = list_reports(today)
        print(f"Newest report: {reports[0][0]} ({len(reports)} listed)")
        if (today - reports[0][0]).days > STALE_DAYS:
            raise NoRate(f"the newest report is from {reports[0][0]:%d %b %Y}, over {STALE_DAYS} days old")
        found = find_rate(reports)
    except NoRate as e:
        msg = f"Couldn't update the 10-year bond rate: {e}. It stays at {saved['value']}% ({fmt_date(saved['date'])})."
        print(msg)
        if a.warn and not a.dry_run:
            telegram(f"⚠️ {msg}")
        output(changed="false")
        sys.exit(1)

    move = found["value"] - saved["value"]
    lo, hi = found["range"]
    print(f"\n10-year rate: {found['value']:.2f}% from trades on {found['date']} "
          f"({len(found['bonds'])} bond(s) with {lo:g}-{hi:g} years left). Saved: {saved['value']}% ({saved['date']}); move {move:+.2f}.")
    if abs(move) < MIN_MOVE:
        print(f"Less than {MIN_MOVE} point: nothing changed.")
        output(changed="false")
        return
    if a.dry_run:
        print(f"Would update the file and post to Telegram (dry run: nothing changed).")
        output(changed="false")
        return

    report_day = fmt_date(found["date"])
    market["bondYield10y"] = {
        **{k: v for k, v in saved.items() if k not in ("value", "date", "source", "bonds", "url")},
        "value": found["value"],
        "unit": "%",
        "date": found["date"],
        "source": f"Public Debt Management Office, Government Securities Secondary Market Trade Summary {report_day}: "
                  f"weighted average yield of rupee treasury bonds with {lo:g}-{hi:g} years left, weighted by amount traded "
                  "(scripts/bond_rate.py)",
        "url": found["url"],
        "bonds": [{"isin": b["isin"], "years": b["years"], "yield": b["yield"], "volumeMn": b["volume"]} for b in found["bonds"]],
    }
    market["updated"] = today.isoformat()
    write_json(MARKET, market)
    arrow = "▲" if move > 0 else "▼"
    telegram(f"🏦 <b>10-year government bond: {found['value']:.2f}%</b> {arrow} (was {saved['value']}%)\n"
             f"Bonds with {lo:g}-{hi:g} years left, traded on {report_day} (Treasury report).")
    output(changed="true", rate=f"{found['value']:.2f}")
    print("Updated research/market-inputs.json and posted to Telegram.")


if __name__ == "__main__":
    main()
