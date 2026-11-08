"""Tell the Telegram channel when a company on the site publishes a new report on the CSE.

Checks the CSE's list of annual and quarterly reports for every company in
data/. The first time a company is checked, its existing reports are noted
silently, except any published after its current analysis (those are the
ones still to be researched). After that, every report not seen before is
announced once. What's been seen is kept in .alert-state/state.json (Actions
cache), so this never commits.
"""
import html
import os
import sys

import alerts
import cse
import telegram
from common import DATA, GENERATED, read_json


def main():
    state = alerts.load_state()
    seen = state.setdefault("reportsSeen", {})
    companies = read_json(GENERATED / "companies.json", {})
    new_items, changed, failed = [], False, False

    for path in sorted(DATA.glob("*.json")):
        d = read_json(path, {})
        ticker = d.get("ticker") or path.stem
        try:
            reports = cse.financial_reports(ticker)
        except Exception as e:
            print(f"::warning::{ticker}: couldn't read the CSE report list ({e}); will try again next time.")
            continue
        print(f"{ticker}: {len(reports)} reports listed")
        first_time = ticker not in seen
        if first_time and not reports:
            continue   # nothing listed yet: don't baseline on an empty list, or old reports would look new later
        known = set(seen.get(ticker, []))
        analysis_date = d.get("analysisDate") or ""
        for r in reports:
            if r["id"] in known:
                continue
            if first_time and not (r["date"] and r["date"] > analysis_date):
                known.add(r["id"]); changed = True        # existing report: note silently
                continue
            name = (d.get("company") or {}).get("name") or companies.get(ticker, {}).get("name") or ticker
            new_items.append((ticker, name, r))
        seen[ticker] = sorted(known)

    if new_items and not telegram.configured():
        print("::warning::New reports found, but Telegram isn't set up; they'll be announced once it is.")
        new_items = []
    if new_items:
        lines = ["📄 <b>New report on the CSE</b>"]
        for ticker, name, r in new_items:
            folder = (read_json(f"research/{ticker}/record.json", {}) or {}).get("localFolder")
            lines.append(f"\n<b>{html.escape(name)}</b> ({ticker})\n{html.escape(r['title'])}"
                         f"{' (' + cse_date(r['date']) + ')' if r['date'] else ''}\n<a href=\"{html.escape(r['url'])}\">Download the PDF</a>")
            if folder:
                lines.append(f"Save it in cse-research\\{html.escape(folder)} and ask Claude to update the analysis.")
        try:
            telegram.send("\n".join(lines))
            for ticker, _, r in new_items:
                seen.setdefault(ticker, [])
                if r["id"] not in seen[ticker]:
                    seen[ticker].append(r["id"])
            changed = True
            print(f"Announced {len(new_items)} new report(s).")
        except Exception as e:
            failed = True
            print(f"::error::Couldn't post new reports to Telegram: {e}. They'll be tried again next time.")

    alerts.write_json(alerts.STATE_FILE, state)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"state_changed={'true' if changed else 'false'}\n")
    return 1 if failed else 0


def cse_date(iso):
    import datetime
    try:
        return datetime.date.fromisoformat(iso).strftime("%-d %b %Y")
    except ValueError:
        return iso


if __name__ == "__main__":
    sys.exit(main())
