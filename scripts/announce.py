"""Post new or updated research, and the latest broker summary, to the Telegram channel.

Runs after each site build. Every research record's latest change-log entry
from the last 7 days that hasn't been announced yet goes into one message.
What has been announced is remembered in .alert-state/state.json (kept in
the Actions cache, like the price alerts), so publishing never commits.
"""
import datetime
import html
import os
import sys

import alerts
import cse
import telegram
from common import DATA, GENERATED, ROOT, read_json

RECENT_DAYS = 7


def broker_message(day):
    """Short Telegram version of a broker summary (broker/<date>.json)."""
    index = {}
    for path in DATA.glob("*.json"):
        d = read_json(path, {})
        for sc in d.get("shareClasses") or [{"symbol": d.get("ticker")}]:
            index[sc.get("symbol")] = d
    lines = [f"📋 <b>Broker summary, {html.escape(day['date'])}</b>" + (f" ({html.escape(day['source'])})" if day.get("source") else "")]
    for h in (day.get("highlights") or [])[:4]:
        lines.append(f"• {html.escape(h)}")
    own = [c for c in day.get("calls") or [] if c.get("code") in index]
    if own:
        lines.append("\n<b>Your companies</b> (broker call vs my fair value)")
        for c in own:
            d = index[c["code"]]
            fv = (d.get("valuation") or {}).get("fairValue")
            tgt = f"target Rs {c['target']:g}" if isinstance(c.get("target"), (int, float)) else "no target"
            mine = f"; mine Rs {fv:g}" if isinstance(fv, (int, float)) else ""
            lines.append(f"• {html.escape((d.get('company') or {}).get('name') or c['code'])}: {html.escape(c.get('rating') or '?')}, {tgt}{mine}")
    divs = day.get("dividends") or []
    if divs:
        lines.append("\n<b>Dividends</b>: " + "; ".join(
            f"{html.escape(v.get('name') or v.get('code'))} Rs {v['dps']:g} (XD {html.escape(v.get('xd') or '?')})"
            for v in divs if isinstance(v.get("dps"), (int, float))))
    link = alerts.site_link("x")
    if link:
        base = link.split("company.html")[0]
        lines.append(f'\n<a href="{html.escape(base)}broker.html?d={day["date"]}">Open the full summary</a>')
    return "\n".join(lines)


def announce_broker(state):
    """Post the newest broker summary (from the last 3 days) once. Returns (changed, failed)."""
    files = sorted((ROOT / "broker").glob("*.json"))
    if not files:
        return False, False
    day = read_json(files[-1], {})
    date = day.get("date")
    try:
        age = (datetime.date.fromisoformat(cse.today_colombo()) - datetime.date.fromisoformat(date)).days
    except (TypeError, ValueError):
        return False, False
    mark = date
    if age > 3 or state.get("brokerAnnounced") == mark or not telegram.configured():
        return False, False
    try:
        telegram.send(broker_message(day))
    except Exception as e:
        print(f"::error::Could not post the broker summary to Telegram: {e}. It will be tried again on the next build.")
        return False, True
    state["brokerAnnounced"] = mark
    print(f"Announced the broker summary for {date}.")
    return True, False


def main():
    state = alerts.load_state()
    b_changed, b_failed = announce_broker(state)
    return research(state, b_changed, b_failed)


def research(state, b_changed, b_failed):
    announced = state.setdefault("announced", {})
    today = datetime.date.fromisoformat(cse.today_colombo())
    prices = read_json(GENERATED / "prices.json", {}).get("symbols", {})
    companies = read_json(GENERATED / "companies.json", {})

    items = []
    for rec_path in sorted((ROOT / "research").glob("*/record.json")):
        rec = read_json(rec_path, {})
        ticker = rec.get("ticker") or rec_path.parent.name
        log = [e for e in rec.get("changeLog") or [] if isinstance(e, dict) and e.get("date")]
        if not log:
            continue
        last = log[-1]
        try:
            age = (today - datetime.date.fromisoformat(last["date"])).days
        except ValueError:
            continue
        mark = f"{last['date']}#{len(log)}"   # date plus entry count: two updates on one day both count
        if age > RECENT_DAYS or announced.get(ticker) == mark:
            continue
        items.append((ticker, last, log[-2] if len(log) > 1 else None, mark))

    if not items:
        print("No new research to announce.")
        return finish(state, b_changed, b_failed)
    if not telegram.configured():
        print("::warning::New research to announce, but Telegram isn't set up (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).")
        return finish(state, b_changed, b_failed)

    lines = ["📊 <b>New research on the CSE site</b>"]
    for ticker, last, prev, _ in items:
        data = read_json(DATA / f"{ticker}.json", {})
        name = (data.get("company") or {}).get("name") or companies.get(ticker, {}).get("name") or ticker
        v = data.get("valuation") or {}
        kind = "Updated" if prev else "New research"
        fv = last.get("fairValue")
        fv_text = (f"fair value Rs {prev['fairValue']:g} → Rs {fv:g}" if prev and isinstance(prev.get("fairValue"), (int, float))
                   and isinstance(fv, (int, float)) and prev["fairValue"] != fv else (f"fair value Rs {fv:g}" if isinstance(fv, (int, float)) else ""))
        buy = last.get("buyPrice") if isinstance(last.get("buyPrice"), (int, float)) else v.get("buyPrice")
        price = (prices.get(ticker) or {}).get("close") or (data.get("price") or {}).get("value")
        gap = ""
        if isinstance(price, (int, float)) and isinstance(fv, (int, float)) and fv:
            g = (price / fv - 1) * 100
            gap = f" Price Rs {price:,.2f}, {abs(g):.0f}% {'above' if g >= 0 else 'below'} fair value."
        lines.append(
            f"\n<b>{html.escape(name)}</b> ({ticker})\n"
            f"{kind}{', based on ' + html.escape(last['basedOn']) if last.get('basedOn') else ''}: {fv_text}"
            f"{f', buy price Rs {buy:g}' if isinstance(buy, (int, float)) else ''}.{gap}")
        link = alerts.site_link(ticker)
        if link:
            lines.append(f'<a href="{html.escape(link)}">Open the analysis</a>')
    try:
        telegram.send("\n".join(lines))
    except Exception as e:
        print(f"::error::Could not post new research to Telegram: {e}. It will be tried again on the next build.")
        return finish(state, b_changed, True)
    for ticker, _, _, mark in items:
        announced[ticker] = mark
    print(f"Announced: {[t for t, *_ in items]}")
    return finish(state, True, b_failed)


def finish(state, changed, failed):
    alerts.write_json(alerts.STATE_FILE, state)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"state_changed={'true' if changed else 'false'}\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
