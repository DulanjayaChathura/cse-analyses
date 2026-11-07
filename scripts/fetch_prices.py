"""Fetch closing prices from the CSE for every share class in data/.

  python scripts/fetch_prices.py               # all symbols (daily job)
  python scripts/fetch_prices.py --missing-only  # only symbols with no price yet

If the CSE can't be reached, the previous prices are kept and a warning is
recorded; the site then shows how old the price is.
"""
import sys

import cse
from common import GENERATED, note_problem, read_json, tickers_and_symbols, write_json

VOLUME_KEYS = ("quantity", "shareVolume", "sharevolume", "tradeVolume", "tradevolume", "turnover")


def num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def traded(row):
    return any((num(row.get(k)) or 0) > 0 for k in VOLUME_KEYS)


def main(missing_only=False):
    path = GENERATED / "prices.json"
    store = read_json(path, {})
    symbols_store = store.setdefault("symbols", {})
    wanted = sorted({s for syms in tickers_and_symbols().values() for s in syms})
    if missing_only:
        wanted = [s for s in wanted if s not in symbols_store]
    if not wanted:
        print("No prices to fetch.")
        return 0

    today = cse.today_colombo()
    try:
        summary = cse.trade_summary()
    except Exception as e:
        summary = {}
        note_problem(f"CSE trade summary unavailable ({e}); trying each share separately.")
    market_traded = any(traded(r) for r in summary.values())

    ok = 0
    for sym in wanted:
        old = symbols_store.get(sym, {})
        row = summary.get(sym)
        price = prev = None
        did_trade = False
        if row and num(row.get("price")):
            price, prev, did_trade = num(row.get("price")), num(row.get("previousClose")), traded(row)
        else:
            try:
                _, _, price, prev = cse.company_info(sym)
                price, prev = num(price), num(prev)
            except Exception as e:
                note_problem(f"{sym}: price fetch failed ({e}); keeping the last known price.")
                if old:
                    old["error"] = str(e)[:200]
                continue
        if not price:
            note_problem(f"{sym}: the CSE returned no price; keeping the last known price.")
            continue

        entry = {
            "close": price,
            "previousClose": prev,
            "change": round(price - prev, 2) if prev else None,
            "changePct": round((price - prev) / prev * 100, 2) if prev else None,
            # On a holiday/weekend nothing trades: keep the old price date.
            "priceDate": today if (market_traded or not old) else old.get("priceDate", today),
            "lastTradeDate": today if did_trade else old.get("lastTradeDate"),
            "fetchedAt": cse.now_utc(),
        }
        symbols_store[sym] = entry
        ok += 1
        print(f"{sym}: {price} (traded today: {did_trade})")

    store["source"] = "cse.lk (unofficial data feed)"
    store["updatedAt"] = cse.now_utc()
    write_json(path, store)
    print(f"Updated {ok} of {len(wanted)} prices.")
    return 0


if __name__ == "__main__":
    sys.exit(main("--missing-only" in sys.argv))
