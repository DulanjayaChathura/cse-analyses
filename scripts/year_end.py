#!/usr/bin/env python3
"""Keep each year's closing prices, so the portfolio can measure every calendar year from 1 January.

For every share in generated/prices.json, the latest close is saved under the year of its price
date in generated/year-end.json. While a year runs the figure moves with each close; once the
year is over its last close stays as that year's year-end price (the start of the next year).

    python scripts/year_end.py
"""
import sys

from common import GENERATED, read_json, write_json

OUT = GENERATED / "year-end.json"


def main():
    prices = (read_json(GENERATED / "prices.json", {}) or {}).get("symbols") or {}
    ye = read_json(OUT, {}) or {}
    years = ye.setdefault("years", {})
    n = 0
    for code, p in prices.items():
        day, close = p.get("priceDate"), p.get("close")
        if not day or not isinstance(close, (int, float)):
            continue
        y = years.setdefault(day[:4], {})
        old = y.get(code)
        if not old or old[0] <= day:
            y[code] = [day, close]
            n += 1
    ye["note"] = "Latest close of each share within each year; a finished year's figure is its year-end close."
    write_json(OUT, ye)
    print(f"Year-end prices: {n} shares updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
