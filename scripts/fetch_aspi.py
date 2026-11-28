#!/usr/bin/env python3
"""Daily ASPI closes, for comparing a portfolio with the market.

Asks the CSE for the last year of daily All Share Price Index closes (the chart on cse.lk,
chartData with chartId 1, period 5) and merges them into generated/aspi.json, so the
history keeps growing past one year. Run by the site build; a failure only prints a warning.

    python scripts/fetch_aspi.py
"""
import datetime
import sys

import cse
from common import GENERATED, read_json, write_json

OUT = GENERATED / "aspi.json"


def main():
    old = read_json(OUT, {}) or {}
    points = {d: v for d, v in old.get("points", [])}
    try:
        rows = cse.post("chartData", {"chartId": "1", "period": "5"})
    except Exception as e:
        print(f"::warning::ASPI history not fetched: {e}")
        return 0
    n = 0
    for r in rows or []:
        d, v = r.get("d"), r.get("v")
        if not isinstance(d, (int, float)) or not isinstance(v, (int, float)):
            continue
        day = datetime.datetime.fromtimestamp(d / 1000, cse.COLOMBO).date().isoformat()
        points[day] = round(float(v), 2)
        n += 1
    if not n:
        print("::warning::The CSE sent no ASPI history this time.")
        return 0
    write_json(OUT, {
        "source": "CSE chartData (All Share Price Index, daily close)",
        "fetchedAt": cse.now_utc(),
        "points": sorted([d, v] for d, v in points.items()),
    })
    print(f"ASPI history: {len(points)} days, latest {max(points)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
