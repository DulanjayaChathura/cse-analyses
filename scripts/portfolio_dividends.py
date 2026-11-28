#!/usr/bin/env python3
"""Daily: read new CSE cash-dividend announcements for the companies in the encrypted portfolio
and save them inside it. Prints only counts, never which companies (the build logs are public).

    python scripts/portfolio_dividends.py      # needs the PORTFOLIO_KEY secret; does nothing without it
"""
import os
import sys

import portfolio_store as ps


def main():
    if not os.environ.get("PORTFOLIO_KEY") or not ps.FILE.exists():
        print("No portfolio to check.")
        return 0
    try:
        data = ps.load()
    except ps.LockedError as e:
        print(f"::warning::{e}")
        return 0
    new = ps.fetch_dividends(data)
    if new:
        ps.save(data)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"changed={'true' if new else 'false'}\n")
    print(f"Portfolio dividends: {new} new.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
