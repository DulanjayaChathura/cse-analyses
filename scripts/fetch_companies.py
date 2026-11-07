"""Fetch the official company name and logo from the CSE for new tickers.

Only tickers not yet in generated/companies.json are fetched, so this runs once
per company. To refresh a company, delete its entry (and logo) and push.
"""
import sys

import cse
from common import GENERATED, note_problem, read_json, tickers_and_symbols, write_json

EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/svg+xml": ".svg", "image/webp": ".webp", "image/gif": ".gif"}


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
        if logo_path:
            try:
                content, ctype = cse.download(cse.LOGO_BASE + logo_path.lstrip("/"))
                ext = EXT.get(ctype.split(";")[0].strip().lower()) or ("." + logo_path.rsplit(".", 1)[-1].lower() if "." in logo_path else ".png")
                out = GENERATED / "logos" / f"{ticker}{ext}"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(content)
                entry["logo"] = f"generated/logos/{ticker}{ext}"
            except Exception as e:
                note_problem(f"{ticker}: logo download failed ({e}); the card will show initials.")
        else:
            note_problem(f"{ticker}: the CSE has no logo for this company; the card will show initials.")
        if not name:
            note_problem(f"{ticker}: the CSE returned no company name; using the name in the analysis file.")
        companies[ticker] = entry
        changed = True
        print(f"{ticker}: {entry['name']} logo={entry['logo']}")
    if changed:
        write_json(path, companies)
    return 0


if __name__ == "__main__":
    sys.exit(main())
