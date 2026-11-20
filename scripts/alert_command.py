#!/usr/bin/env python3
"""Telegram commands for your own price targets (alerts.json).

The listener (listener/worker.js) starts the "Alert command" workflow with the command text;
this script edits alerts.json and replies in the channel. No Claude involved.

  /alert DIAL below 45 [note]     alert when the price falls to Rs 45 or lower (replaces an
                                  existing "below" target for the same share)
  /alert COMB above 220 [note]    alert when it rises to Rs 220 or more
  /alert DIAL 45 [note]           below or above, worked out from today's price
  /unalert DIAL [below|above]     remove the share's targets (or just one direction)
  /alerts                         list your targets with today's price

Short codes (DIAL) mean the voting share (DIAL.N0000); give the full code for other classes
(DIAL.X0000). Prints `changed=true` to $GITHUB_OUTPUT when alerts.json was changed.

    python scripts/alert_command.py "<command text>" [message_id]
"""
import html
import json
import os
import re
import sys

import cse
import telegram
from common import DATA, ROOT, read_json

ALERTS = ROOT / "alerts.json"
CODE = re.compile(r"^[A-Z][A-Z0-9&]{0,9}(?:\.[A-Z]\d{4})?$")
ADD = re.compile(r"^/alert(?:@\w+)?\s+(\S+)(?:\s+(below|above|under|over))?\s+(?:rs\.?\s*)?([\d,]*\.?\d+)\s*(.*)$", re.I | re.S)
REMOVE = re.compile(r"^/unalert(?:@\w+)?\s+(\S+)(?:\s+(below|above|under|over))?\s*$", re.I)
LIST = re.compile(r"^/alerts(?:@\w+)?\s*$", re.I)
WORDS = {"under": "below", "over": "above"}


def esc(s):
    return html.escape(str(s), quote=False)


def money(x):
    return f"Rs {x:,.2f}".rstrip("0").rstrip(".") if x % 1 else f"Rs {x:,.0f}"


def load():
    data = read_json(ALERTS, {"targets": []})
    if not isinstance(data, dict) or not isinstance(data.get("targets"), list):
        data = {"targets": []}
    return data


def save(data):
    ALERTS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def symbol_of(code):
    """(symbol, name, last price) from the CSE, or (None, None, None) if it doesn't know the code."""
    code = code.upper().strip()
    if not CODE.match(code):
        return None, None, None
    sym = code if "." in code else code + ".N0000"
    try:
        name, _, last, prev = cse.company_info(sym)
    except Exception:
        return None, None, None
    if not name:
        return None, None, None
    price = last if isinstance(last, (int, float)) and last > 0 else (prev if isinstance(prev, (int, float)) and prev > 0 else None)
    return sym, cse.nice_name(name), price


def gap(price, target):
    if not price:
        return ""
    d = (target / price - 1) * 100
    return f"{abs(d):.1f}% {'below' if d < 0 else 'above'} today's {money(price)}"


def auto_count():
    n = 0
    for p in DATA.glob("*.json"):
        d = read_json(p, None)
        if isinstance(d, dict) and (d.get("quality") or {}).get("rating") == "good":
            n += 1
    return n


def add(m):
    code, direction, price, note = m.group(1), m.group(2), m.group(3), (m.group(4) or "").strip()
    sym, name, now = symbol_of(code)
    if not sym:
        return f"⚠️ I couldn't find <b>{esc(code)}</b> on the CSE. Use the share code, e.g. DIAL or DIAL.N0000. Nothing changed.", False
    try:
        target = float(price.replace(",", ""))
    except ValueError:
        target = 0
    if target <= 0:
        return "⚠️ The price must be a number above 0, e.g. <code>/alert DIAL below 45</code>. Nothing changed.", False
    direction = WORDS.get((direction or "").lower(), (direction or "").lower())
    if not direction:
        if not now:
            return (f"⚠️ I couldn't get today's price for {esc(name)}, so I can't tell whether {money(target)} is below or above it. "
                    f"Say which: <code>/alert {esc(code)} below {price}</code>. Nothing changed."), False
        direction = "below" if target < now else "above"
    if now and ((direction == "below" and now <= target) or (direction == "above" and now >= target)):
        warn = f"\n⚠️ Today's price is already {'at or below' if direction == 'below' else 'at or above'} it, so it will alert at the next check."
    elif now and abs(target / now - 1) > 0.5:
        warn = f"\n⚠️ That's more than 50% from today's {money(now)}: check the price."
    else:
        warn = ""
    data = load()
    old = [t for t in data["targets"] if t.get("symbol") == sym and t.get("direction") == direction]
    data["targets"] = [t for t in data["targets"] if not (t.get("symbol") == sym and t.get("direction") == direction)]
    entry = {"symbol": sym, "direction": direction, "price": target}
    if note:
        entry["note"] = note[:200]
    data["targets"].append(entry)
    save(data)
    was = f" (was {money(float(old[0]['price']))})" if old and isinstance(old[0].get("price"), (int, float)) else ""
    return (f"🔔 Alert set: <b>{esc(name)}</b> ({sym}) {direction} <b>{money(target)}</b>{was}."
            + (f" {gap(now, target)[:1].upper()}{gap(now, target)[1:]}." if now else "")
            + (f"\nNote: {esc(note)}" if note else "")
            + warn
            + "\nChecked about every 30 minutes during trading, and after the close."), True


def remove(m):
    code, direction = m.group(1), WORDS.get((m.group(2) or "").lower(), (m.group(2) or "").lower())
    c = code.upper()
    sym = c if "." in c else c + ".N0000"
    data = load()
    gone = [t for t in data["targets"] if t.get("symbol") == sym and (not direction or t.get("direction") == direction)]
    if not gone:
        return f"⚠️ You have no {direction + ' ' if direction else ''}alert for <b>{esc(sym)}</b>. Send <code>/alerts</code> to see them. Nothing changed.", False
    data["targets"] = [t for t in data["targets"] if t not in gone]
    save(data)
    return "🔔 Removed: " + "; ".join(f"{t['symbol']} {t['direction']} {money(float(t['price']))}" for t in gone) + ".", True


def listing():
    targets = [t for t in load()["targets"] if isinstance(t, dict) and t.get("symbol")]
    lines = ["🔔 <b>Your price alerts</b>"]
    if not targets:
        lines.append("None yet. Add one with <code>/alert DIAL below 45</code>.")
    for t in sorted(targets, key=lambda t: (t["symbol"], t.get("direction", ""))):
        _, name, now = symbol_of(t["symbol"])
        p = float(t["price"]) if isinstance(t.get("price"), (int, float)) else None
        line = f"• <b>{esc(name or t['symbol'])}</b> ({t['symbol']}) {t.get('direction')} {money(p) if p else '?'}"
        if p and now:
            line += f": {gap(now, p)}"
        if t.get("note"):
            line += f" · {esc(t['note'])}"
        lines.append(line)
    n = auto_count()
    lines.append(f"\nAlso automatic: the buy and strong-buy prices of the {n} watch-list companies (no need to add them).")
    lines.append("Change one: <code>/alert CODE below|above PRICE</code> · remove: <code>/unalert CODE</code>")
    return "\n".join(lines), False


def handle(text):
    text = (text or "").strip()
    for rx, fn in ((LIST, lambda m: listing()), (REMOVE, remove), (ADD, add)):
        m = rx.match(text)
        if m:
            return fn(m)
    return ("⚠️ I didn't understand that. Examples:\n<code>/alert DIAL below 45</code>\n<code>/alert COMB above 220 take profit</code>\n"
            "<code>/unalert DIAL</code>\n<code>/alerts</code>"), False


def main():
    text = sys.argv[1] if len(sys.argv) > 1 else ""
    message_id = sys.argv[2] if len(sys.argv) > 2 else ""
    reply, changed = handle(text)
    print(re.sub(r"<[^>]+>", "", reply))
    if os.environ.get("TELEGRAM_BOT_TOKEN"):
        params = {"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": reply, "parse_mode": "HTML", "disable_web_page_preview": "true"}
        if message_id:
            params.update(reply_to_message_id=message_id, allow_sending_without_reply="true")
        telegram.call("sendMessage", params)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
