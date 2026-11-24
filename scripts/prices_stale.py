#!/usr/bin/env python3
"""Are the saved closing prices older than the latest CSE close?

Used by the backup price check (price-check.yml). Prints the answer and, with --github,
writes stale=true/false to $GITHUB_OUTPUT. Reads only generated/prices.json: no CSE call.

    python scripts/prices_stale.py [--github]
"""
import os
import sys

from common import GENERATED, read_json, tickers_and_symbols
from fetch_prices import is_stale
import cse


def main(argv):
    store = read_json(GENERATED / "prices.json", {}).get("symbols", {})
    wanted = sorted({s for syms in tickers_and_symbols().values() for s in syms})
    stale = is_stale(store, wanted)
    print(f"Latest close: {cse.last_session_date()}. Prices {'are older than it' if stale else 'are up to date'}.")
    if "--github" in argv and os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"stale={'true' if stale else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
