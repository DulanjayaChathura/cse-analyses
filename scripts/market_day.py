#!/usr/bin/env python3
"""Is the Colombo Stock Exchange open today (Sri Lanka date)?

Weekends and the holidays in research/market-holidays.json are closed days. Used by the
price workflows and the daily price-check task so nothing fetches prices on a closed day.

    python scripts/market_day.py              # today; exit 0 if open, 1 if closed
    python scripts/market_day.py 2026-11-24   # a given date
    python scripts/market_day.py --github     # also write open=true/false to $GITHUB_OUTPUT

If the year isn't in the holiday file, it says so and treats weekdays as open (better an
unneeded price fetch than a missed one).
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SL = timezone(timedelta(hours=5, minutes=30))


def check(day):
    if day.weekday() >= 5:
        return False, "weekend"
    data = json.loads((ROOT / "research" / "market-holidays.json").read_text(encoding="utf-8"))
    year = data.get("years", {}).get(str(day.year))
    if not year:
        return True, f"no holiday list for {day.year} in research/market-holidays.json (add it from the year's gazette); treating as open"
    for d, name in year.get("holidays", []):
        if d == day.isoformat():
            return False, f"market holiday: {name}"
    return True, "trading day"


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    day = date.fromisoformat(args[0]) if args else datetime.now(SL).date()
    is_open, why = check(day)
    print(f"{day.isoformat()}: {'open' if is_open else 'closed'} ({why})")
    if "--github" in argv and os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"open={'true' if is_open else 'false'}\n")
        if "no holiday list" in why:
            print(f"::warning::{why}")
        return 0
    return 0 if is_open else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
