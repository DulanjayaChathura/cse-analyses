"""Check your price targets in alerts.json and post to Telegram when one is crossed.

  python scripts/alerts.py --live    # during trading: latest price from the CSE
  python scripts/alerts.py --close   # after the close: price from generated/prices.json

Each target fires once. Which targets have fired is remembered in
.alert-state/state.json, which the workflows keep in GitHub's Actions cache
(not in the repository, so sending an alert never creates a commit).
A target re-arms when you change it (symbol, direction or price), or when
the "alert-state" caches are deleted under Actions -> Caches.
"""
import datetime
import html
import json
import os
import re
import sys

import cse
import telegram
from common import DATA, GENERATED, ROOT, read_json, write_json

ALERTS_FILE = ROOT / "alerts.json"
STATE_FILE = ROOT / ".alert-state" / "state.json"
SYMBOL_RE = re.compile(r"^[A-Z0-9]+\.[A-Z]\d{4}$")


def target_key(t):
    return f"{t['symbol']}|{t['direction']}|{float(t['price']):g}"


def load_targets():
    """Return (valid targets, list of problems) from alerts.json."""
    if not ALERTS_FILE.exists():
        return [], []
    try:
        data = json.loads(ALERTS_FILE.read_text(encoding="utf-8"))
    except ValueError as e:
        return [], [f"alerts.json is not valid JSON: {e}"]
    items = data.get("targets") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return [], ['alerts.json must look like {"targets": [ ... ]}']
    targets, problems = [], []
    for i, t in enumerate(items, 1):
        if not isinstance(t, dict):
            problems.append(f"alerts.json target {i}: must be an object")
            continue
        sym, d, p = t.get("symbol"), t.get("direction"), t.get("price")
        errs = []
        if not isinstance(sym, str) or not SYMBOL_RE.match(sym):
            errs.append('symbol must look like "DIAL.N0000"')
        if d not in ("below", "above"):
            errs.append('direction must be "below" or "above"')
        if not isinstance(p, (int, float)) or isinstance(p, bool) or p <= 0:
            errs.append("price must be a positive number")
        if errs:
            problems.append(f"alerts.json target {i}: " + "; ".join(errs) + " (ignored)")
            continue
        t = {"symbol": sym, "direction": d, "price": float(p), "note": str(t.get("note") or "")}
        t["key"] = target_key(t)
        targets.append(t)
    return targets, problems


def load_state():
    s = read_json(STATE_FILE, {})
    return s if isinstance(s.get("fired"), dict) else {"fired": {}}


def crossed(t, price):
    return price <= t["price"] if t["direction"] == "below" else price >= t["price"]


def symbol_to_ticker():
    out = {}
    for p in DATA.glob("*.json"):
        d = read_json(p, None)
        if not isinstance(d, dict):
            continue
        t = d.get("ticker") or p.stem
        out[t] = t
        for c in d.get("shareClasses") or []:
            if isinstance(c, dict) and c.get("symbol"):
                out[c["symbol"]] = t
    return out


def company_context(ticker):
    d = read_json(DATA / f"{ticker}.json", {}) if ticker else {}
    v = d.get("valuation") if isinstance(d.get("valuation"), dict) else {}
    name = read_json(GENERATED / "companies.json", {}).get(ticker or "", {}).get("name") \
        or (d.get("company") or {}).get("name") or ticker
    return name, v


def site_link(ticker):
    base = os.environ.get("SITE_URL")
    if not base and os.environ.get("GITHUB_REPOSITORY"):
        owner, repo = os.environ["GITHUB_REPOSITORY"].split("/", 1)
        base = f"https://{owner.lower()}.github.io/{repo}/"
    if not base or not ticker:
        return None
    return base.rstrip("/") + f"/company.html?t={ticker}"


def rs(v):
    return f"Rs {v:,.2f}"


def live_prices(symbols):
    """Latest traded price for each symbol, straight from the CSE."""
    out = {}
    try:
        summary = cse.trade_summary()
    except Exception as e:
        summary = {}
        print(f"::warning::CSE trade summary unavailable ({e}); trying each share separately.")
    stamp = datetime.datetime.now(cse.COLOMBO).strftime("%H:%M on %d %b")
    for s in symbols:
        row = summary.get(s)
        price = None
        try:
            price = float(row["price"]) if row and row.get("price") else None
        except (TypeError, ValueError):
            price = None
        if not price:
            try:
                price = cse.company_info(s)[2]
                price = float(price) if price else None
            except Exception as e:
                print(f"::warning::{s}: price unavailable ({e}); will check again next time.")
        if price:
            out[s] = (price, f"latest trade at {stamp} (Sri Lanka time)")
    return out


def close_prices(symbols):
    store = read_json(GENERATED / "prices.json", {}).get("symbols", {})
    out = {}
    for s in symbols:
        p = store.get(s) or {}
        if isinstance(p.get("close"), (int, float)) and p["close"] > 0:
            try:
                day = datetime.date.fromisoformat(p.get("priceDate", "")).strftime("%-d %b %Y")
            except ValueError:
                day = "the last trading day"
            out[s] = (float(p["close"]), f"close on {day}")
    return out


def build_message(ticker, symbol_hits, prices):
    name, v = company_context(ticker)
    lines = [f"🔔 <b>{html.escape(name or symbol_hits[0][0]['symbol'])}</b>"]
    by_symbol = {}
    for t, _ in symbol_hits:
        by_symbol.setdefault(t["symbol"], []).append(t)
    for sym, ts in by_symbol.items():
        price, when = prices[sym]
        lines.append(f"\n<b>{sym}</b> {rs(price)} ({html.escape(when)})")
        for t in ts:
            arrow = "⬇️ At or below" if t["direction"] == "below" else "⬆️ At or above"
            note = f": {html.escape(t['note'])}" if t["note"] else ""
            lines.append(f"{arrow} your target {rs(t['price'])}{note}")
    ref = []
    if isinstance(v.get("fairValue"), (int, float)):
        ref.append(f"fair value Rs {v['fairValue']:g}")
    if isinstance(v.get("buyPrice"), (int, float)):
        ref.append(f"buy price Rs {v['buyPrice']:g}")
    if ref:
        lines.append("\nFrom the analysis: " + ", ".join(ref) + ".")
    link = site_link(ticker)
    if link:
        lines.append(f'<a href="{html.escape(link)}">Open the analysis</a>')
    return "\n".join(lines)


def main(mode):
    targets, problems = load_targets()
    for p in problems:
        print(f"::error::{p}")
    state = load_state()
    fired = state["fired"]

    # Forget targets that no longer exist, so removing and re-adding one re-arms it.
    keys = {t["key"] for t in targets}
    changed = False
    for k in list(fired):
        if k not in keys:
            del fired[k]
            changed = True

    pending = [t for t in targets if t["key"] not in fired]
    print(f"{len(targets)} targets, {len(pending)} not yet fired.")
    if not pending:
        return finish(state, changed, problems, failed=False)

    symbols = sorted({t["symbol"] for t in pending})
    prices = live_prices(symbols) if mode == "live" else close_prices(symbols)
    hits = [(t, prices[t["symbol"]][0]) for t in pending if t["symbol"] in prices and crossed(t, prices[t["symbol"]][0])]
    if not hits:
        print("No targets crossed.")
        return finish(state, changed, problems, failed=False)

    if not telegram.configured():
        print("::error::A target was crossed, but Telegram isn't set up (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets). It will be sent once they're added.")
        return finish(state, changed, problems, failed=True)

    tickers = symbol_to_ticker()
    groups = {}
    for t, p in hits:
        groups.setdefault(tickers.get(t["symbol"], t["symbol"]), []).append((t, p))

    failed = False
    now = datetime.datetime.now(cse.COLOMBO).replace(microsecond=0).isoformat()
    for ticker, group in groups.items():
        try:
            telegram.send(build_message(ticker, group, prices))
        except Exception as e:
            failed = True
            print(f"::error::Could not send the Telegram alert for {ticker}: {e}. It will be retried at the next check.")
            continue
        for t, p in group:
            fired[t["key"]] = {"at": now, "price": p, "symbol": t["symbol"], "direction": t["direction"], "target": t["price"]}
        changed = True
        print(f"Sent alert for {ticker}: {[t['key'] for t, _ in group]}")
    return finish(state, changed, problems, failed)


def finish(state, changed, problems, failed):
    write_json(STATE_FILE, state)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"state_changed={'true' if changed else 'false'}\n")
    # Mistakes in alerts.json are reported by the site build when you save the file,
    # so they don't also fail every 30-minute check.
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main("close" if "--close" in sys.argv else "live"))
