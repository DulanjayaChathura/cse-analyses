"""Fetch the official company name and logo from the CSE for new tickers.

Only tickers not yet in generated/companies.json are fetched, so this runs once
per company. To refresh a company, delete its entry (and logo) and push.
"""
import json
import re
import sys

import cse
from common import GENERATED, ROOT, note_problem, read_json, tickers_and_symbols, write_json

EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/svg+xml": ".svg", "image/webp": ".webp", "image/gif": ".gif"}


def save_logo(code, logo_path):
    """Download a company's CSE logo to generated/logos/<code>.<ext>; returns its site path or None."""
    if not logo_path:
        note_problem(f"{code}: the CSE has no logo for this company; initials are shown instead.")
        return None
    try:
        content, ctype = cse.download(cse.LOGO_BASE + logo_path.lstrip("/"))
        ext = EXT.get(ctype.split(";")[0].strip().lower()) or ("." + logo_path.rsplit(".", 1)[-1].lower() if "." in logo_path else ".png")
        out = GENERATED / "logos" / f"{code}{ext}"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(content)
        return f"generated/logos/{code}{ext}"
    except Exception as e:
        note_problem(f"{code}: logo download failed ({e}); initials are shown instead.")
        return None


def main():
    path = GENERATED / "companies.json"
    companies = read_json(path, {})
    changed = False
    for ticker in tickers_and_symbols():
        if ticker in companies and companies[ticker].get("name"):
            continue
        try:
            name, logo_path, _, _ = cse.company_info(ticker)
        except Exception as e:
            note_problem(f"{ticker}: could not fetch the company name and logo from the CSE ({e}). Will retry on the next run.")
            continue
        entry = {"name": cse.nice_name(name) if name else None, "cseName": name, "logo": None, "fetchedAt": cse.now_utc()}
        entry["logo"] = save_logo(ticker, logo_path)
        if not name:
            note_problem(f"{ticker}: the CSE returned no company name; using the name in the analysis file.")
        companies[ticker] = entry
        changed = True
        print(f"{ticker}: {entry['name']} logo={entry['logo']}")
    if changed:
        write_json(path, companies)
    return 0


def full_code(code):
    """Broker pages sometimes give a short code ("CTEA", "SEYB.X"); make it a full CSE code."""
    code = str(code or "").strip().upper()
    if not code:
        return None
    if re.fullmatch(r"[A-Z0-9]+\.[NXRWZ]\d{4}", code):
        return code
    if re.fullmatch(r"[A-Z0-9]+\.[NX]", code):
        return code + "0000"
    if re.fullmatch(r"[A-Z0-9]+", code):
        return code + ".N0000"
    return None


def broker_codes():
    """Every share code mentioned on the broker pages: calls, dividends, research, and the
    market section (foreign flows, momentum, heat map, gainers and losers)."""
    codes = set()
    for path in sorted((ROOT / "broker").glob("*.json")):
        day = read_json(path, {}) or {}
        m = day.get("market") or {}
        items = (day.get("calls") or []) + (day.get("dividends") or []) + (day.get("research") or []) + \
            (m.get("foreignFlows") or []) + (m.get("momentum") or []) + (m.get("heatmap") or [])
        codes |= {full_code(i.get("code")) for i in items if isinstance(i, dict)}
        codes |= {full_code(c) for c in (m.get("gainers") or []) + (m.get("losers") or [])}
    return sorted(c for c in codes if c)


def share_names():
    """generated/share-names.json: {code: {name, logo}} for every code on the broker pages, so
    the page shows "Access Engineering" with its logo instead of "AEL". Fetched once per code
    from the CSE; companies already on the site reuse their saved name and logo."""
    path = GENERATED / "share-names.json"
    names = read_json(path, {})
    companies = read_json(GENERATED / "companies.json", {})
    changed = False
    for code in broker_codes():
        have = names.get(code)
        if isinstance(have, dict) and have.get("name") and "logo" in have:
            continue
        known = companies.get(code) or {}
        if known.get("name"):
            entry = {"name": known["name"], "logo": known.get("logo")}
        else:
            try:
                raw, logo_path, _, _ = cse.company_info(code)
            except Exception as e:
                note_problem(f"{code}: could not fetch its company name from the CSE ({e}). Will retry on the next run.")
                continue
            if not raw:
                continue
            entry = {"name": cse.nice_name(raw), "logo": save_logo(code, logo_path)}
        names[code] = entry
        changed = True
        print(f"{code}: {entry['name']} logo={entry['logo']}")
    if changed:
        write_json(path, dict(sorted(names.items())))


if __name__ == "__main__":
    code = main()
    share_names()
    sys.exit(code)
