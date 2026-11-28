#!/usr/bin/env python3
"""Telegram commands for the owner's portfolio (kept encrypted in portfolio.enc.json).

The listener (listener/worker.js) starts the "Portfolio command" workflow with the command
text; this script unlocks the portfolio with the PORTFOLIO_KEY secret, changes it, locks it
again and replies in the channel. No Claude involved.

  /buy COCR 200 95.20 [date] [fees 213.25]   record a purchase (fees default to the CSE's 1.12%)
  /sell DIAL 100 46 [date] [fees 52]         record a sale
  /div COMB 6.50 [xd date] [pay date]        record a dividend by hand (normally read from the CSE)
  /holdings                                   what you hold, with today's value and return
  /trades [COCR]                              your recorded trades and dividends, numbered
  /undo [number]                              remove the last entry, or entry number N

Dates: 2026-11-27, 11/27 (month/day), 27/11 (day/month when the first number is over 12),
27 (that day this month, or last month if it hasn't come yet), today or yesterday.
Short codes (COCR) mean the voting share; give the full code for others (HNB.X0000).
Prints `changed=true` to $GITHUB_OUTPUT when the portfolio was changed.

    python scripts/portfolio_command.py "<command text>" [message_id]
"""
import datetime
import html
import os
import re
import sys

import portfolio_store as ps
from common import GENERATED, read_json

COLOMBO = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
NUM = r"(?:rs\.?\s*)?([\d,]*\.?\d+)"
TRADE = re.compile(rf"^/(buy|sell)(?:@\w+)?\s+(\S+)\s+([\d,]+)\s+{NUM}(.*)$", re.I | re.S)
DIV = re.compile(rf"^/div(?:@\w+)?\s+(\S+)\s+{NUM}(.*)$", re.I | re.S)
HOLD = re.compile(r"^/holdings(?:@\w+)?\s*$", re.I)
TRADES = re.compile(r"^/trades(?:@\w+)?(?:\s+(\S+))?\s*$", re.I)
UNDO = re.compile(r"^/undo(?:@\w+)?(?:\s+#?(\d+))?\s*$", re.I)
FEES = re.compile(rf"\bfees?\s+{NUM}", re.I)


def esc(s):
    return html.escape(str(s), quote=False)


def rs(x, d=2):
    return f"Rs {x:,.{d}f}"


def today():
    return datetime.datetime.now(COLOMBO).date()


def parse_date(word, base=None):
    """A date from 2026-11-27, 11/27, 27/11, 27, today or yesterday. None if it isn't one."""
    base = base or today()
    w = word.strip().lower()
    if w in ("today", ""):
        return base
    if w == "yesterday":
        return base - datetime.timedelta(days=1)
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", w)
    try:
        if m:
            return datetime.date(int(m[1]), int(m[2]), int(m[3]))
        m = re.fullmatch(r"(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?", w)
        if m:
            a, b = int(m[1]), int(m[2])
            month, day = (b, a) if a > 12 else (a, b)  # month/day, unless the first can't be a month
            year = int(m[3]) + (2000 if m[3] and len(m[3]) == 2 else 0) if m[3] else base.year
            d = datetime.date(year, month, day)
            return d if m[3] or d <= base else datetime.date(year - 1, month, day)
        m = re.fullmatch(r"(\d{1,2})", w)
        if m:
            day = int(m[1])
            d = datetime.date(base.year, base.month, day)
            if d > base:  # that day hasn't come yet this month: last month
                prev = (base.replace(day=1) - datetime.timedelta(days=1))
                d = datetime.date(prev.year, prev.month, day)
            return d
    except ValueError:
        return None
    return None


def resolve(code):
    """(full code, name, price) from the CSE; offline tests set PORTFOLIO_OFFLINE."""
    code = code.upper().strip()
    if os.environ.get("PORTFOLIO_OFFLINE"):
        full = code if "." in code else code + ".N0000"
        return full, full, None
    from alert_command import symbol_of
    return symbol_of(code)


def price_of(code):
    p = (read_json(GENERATED / "prices.json", {}).get("symbols") or {}).get(code) or {}
    return p.get("close") if isinstance(p.get("close"), (int, float)) else None


def trade(m, data):
    side, code_in, n, p, rest = m[1].lower(), m[2], int(m[3].replace(",", "")), float(m[4].replace(",", "")), m[5] or ""
    if n <= 0 or p <= 0:
        return "⚠️ The number of shares and the price must be above zero.", False
    fees_m = FEES.search(rest)
    fees = float(fees_m[1].replace(",", "")) if fees_m else round(n * p * ps.FEE_RATE, 2)
    rest = FEES.sub(" ", rest).strip()
    day = parse_date(rest.split()[0]) if rest else today()
    if day is None:
        return f"⚠️ I couldn't read the date <code>{esc(rest.split()[0])}</code>. Use 2026-11-27, 11/27, 27 or yesterday.", False
    if day > today():
        return "⚠️ That date is in the future.", False
    code, name, _ = resolve(code_in)
    if not code:
        return f"⚠️ The CSE doesn't know the code <code>{esc(code_in)}</code>.", False
    held = ps.holdings(data).get(code, {}).get("shares", 0)
    if side == "sell":
        held_then = ps.shares_on(data, code, (day + datetime.timedelta(days=1)).isoformat())
        if n > held_then:
            return f"⚠️ You hold {held_then:,} {esc(code)} on {day:%d %b %Y}, so you can't sell {n:,}.", False
    tid = ps.next_id(data)
    data["trades"].append({"id": tid, "d": day.isoformat(), "code": code, "side": side, "n": n, "p": p, "fees": fees,
                           "added": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()})
    new_divs = 0
    if code not in (data.get("dividends") or {}) and not os.environ.get("PORTFOLIO_OFFLINE"):
        new_divs = ps.fetch_dividends(data, [code], quiet=True)
    h = ps.holdings(data).get(code, {"shares": 0, "cost": 0})
    lines = [f"✅ #{tid} {'Bought' if side == 'buy' else 'Sold'} {n:,} <b>{esc(name or code)}</b> at {rs(p)} on {day:%d %b %Y} (fees {rs(fees)})."]
    if h["shares"]:
        lines.append(f"Holding {h['shares']:,} · average {rs(h['cost'] / h['shares'])} incl. fees · cost {rs(h['cost'], 0)}")
    else:
        lines.append("You no longer hold any.")
    if side == "sell":
        before = ps.holdings({"trades": [t for t in data["trades"] if t["id"] != tid]}).get(code, {})
        avg = before["cost"] / before["shares"] if before.get("shares") else 0
        gain = n * p - fees - avg * n
        lines.append(f"{'Gain' if gain >= 0 else 'Loss'} on this sale: {'+' if gain >= 0 else '−'}{rs(abs(gain))}")
    if new_divs:
        lines.append(f"📅 {new_divs} past dividend announcements found for this company; the ones you qualify for are counted.")
    lines.append("The portfolio page updates in a minute or two.")
    return "\n".join(lines), True


def div(m, data):
    code_in, dps, rest = m[1], float(m[2].replace(",", "")), (m[3] or "").split()
    xd = parse_date(rest[0]) if rest else today()
    pay = parse_date(rest[1]) if len(rest) > 1 else xd
    if xd is None or pay is None:
        return "⚠️ I couldn't read the date. Example: <code>/div COMB 6.50 2026-04-16</code> (XD date, then pay date if different).", False
    code, name, _ = resolve(code_in)
    if not code:
        return f"⚠️ The CSE doesn't know the code <code>{esc(code_in)}</code>.", False
    held = ps.shares_on(data, code, xd.isoformat())
    if not held:
        return f"⚠️ You didn't hold {esc(code)} before {xd:%d %b %Y} (the XD date), so that dividend isn't yours.", False
    mid = ps.next_id(data)
    data["manual"].append({"id": mid, "code": code, "dps": dps, "xd": xd.isoformat(), "pay": pay.isoformat(), "note": "Entered by hand"})
    net = held * dps * (1 - ps.DIV_TAX)
    return (f"✅ #{mid} Dividend {rs(dps)} a share on {held:,} <b>{esc(name or code)}</b>: {rs(net)} after "
            f"{ps.DIV_TAX * 100:.0f}% tax, paid {pay:%d %b %Y}.\nNormally dividends are read from the CSE's announcements "
            f"by themselves; use this only for one that's missing."), True


def holdings_reply(data):
    allpos = ps.holdings(data)
    pos = {c: h for c, h in allpos.items() if h["shares"] > 0}
    closed = {c: h for c, h in allpos.items() if h["shares"] <= 0}
    if not pos and not closed:
        return "💼 Your portfolio is empty. Add a purchase with <code>/buy COCR 200 95.20</code>."
    t = today().isoformat()
    got = {}
    for e in ps.dividend_events(data):
        if (e.get("pay") or e["xd"]) <= t:
            got[e["code"]] = got.get(e["code"], 0) + e["net"]
    lines, tv, tc, tr = ["💼 <b>Your holdings</b>"], 0.0, 0.0, 0.0
    for code, h in sorted(pos.items(), key=lambda kv: -(kv[1]["shares"] * (price_of(kv[0]) or 0))):
        p = price_of(code)
        avg = h["cost"] / h["shares"]
        if p is None:
            lines.append(f"• {esc(code)}: {h['shares']:,} × {rs(avg)} (no price yet)")
            continue
        v = h["shares"] * p
        ret = v - h["cost"] + got.get(code, 0) + h["realised"]
        tv, tc, tr = tv + v, tc + h["cost"], tr + ret
        lines.append(f"• <b>{esc(code.split('.')[0])}</b> {h['shares']:,} × {rs(p)} = {rs(v, 0)} · "
                     f"{'▲' if ret >= 0 else '▼'} {rs(abs(ret), 0)} ({ret / h['cost'] * 100:+.1f}%)")
    for code, h in closed.items():  # sold out: its gains (and dividends while held) still count
        r = h["realised"] + got.get(code, 0)
        tr += r
        lines.append(f"• {esc(code.split('.')[0])}: sold out · {'+' if r >= 0 else '−'}{rs(abs(r), 0)} taken")
    if tc:
        lines.append(f"\n<b>Total</b> {rs(tv, 0)} · cost {rs(tc, 0)} incl. fees · return {'+' if tr >= 0 else '−'}{rs(abs(tr), 0)} ({tr / tc * 100:+.1f}%)")
    lines.append("Dividends received and gains on sales are included; dividends after "
                 f"{ps.DIV_TAX * 100:.0f}% tax.")
    return "\n".join(lines)


def trades_reply(data, code_in=None):
    code = None
    if code_in:
        code = code_in.upper() if "." in code_in else code_in.upper() + ".N0000"
    items = [dict(t, k="t") for t in data["trades"]] + [dict(x, k="m", d=x["xd"]) for x in data["manual"]]
    items += [dict(e, k="c", d=e["xd"]) for e in ps.dividend_events(data) if e["source"] == "cse"]
    if code:
        items = [x for x in items if x["code"] == code]
    if not items:
        return "🧾 Nothing recorded yet." if not code else f"🧾 Nothing recorded for {esc(code)}."
    items.sort(key=lambda x: x["d"], reverse=True)
    lines = ["🧾 <b>Trades and dividends</b> (newest first)"]
    for x in items[:30]:
        c = esc(x["code"].split(".")[0])
        if x["k"] == "t":
            lines.append(f"#{x['id']} {x['d']} {'Buy' if x['side'] == 'buy' else 'Sell'} {x['n']:,} {c} at {rs(x['p'])} (fees {rs(x['fees'])})")
        elif x["k"] == "m":
            lines.append(f"#{x['id']} {x['d']} Dividend {c} {rs(x['dps'])} a share (by hand)")
        else:
            lines.append(f"· {x['d']} Dividend {c} {rs(x['dps'])} × {x['shares']:,} = {rs(x['net'])} after tax (from the CSE, XD {x['xd']})")
    if len(items) > 30:
        lines.append(f"… and {len(items) - 30} older.")
    lines.append("Remove one with <code>/undo 12</code> (its number), or the last one with <code>/undo</code>.")
    return "\n".join(lines)


def undo(m, data):
    entries = [(t["id"], "t", t) for t in data["trades"]] + [(x["id"], "m", x) for x in data["manual"]]
    if not entries:
        return "⚠️ There's nothing to undo.", False
    if m[1]:
        hit = [e for e in entries if e[0] == int(m[1])]
        if not hit:
            return f"⚠️ There's no entry #{int(m[1])}. See <code>/trades</code>.", False
        eid, kind, x = hit[0]
    else:
        eid, kind, x = max(entries, key=lambda e: e[0])
    if kind == "t":
        rest = [t for t in data["trades"] if t["id"] != eid]
        # removing a buy mustn't leave a later sale selling shares you never had
        for t in rest:
            if t["side"] == "sell" and t["code"] == x["code"] and ps.shares_on({"trades": [r for r in rest if r["d"] <= t["d"] and r["id"] != t["id"]]}, t["code"], "9999") < t["n"]:
                return f"⚠️ Removing #{eid} would leave sale #{t['id']} selling shares you didn't hold. Undo that sale first.", False
        data["trades"] = rest
        what = f"{'buy' if x['side'] == 'buy' else 'sale'} of {x['n']:,} {esc(x['code'])} at {rs(x['p'])} on {x['d']}"
    else:
        data["manual"] = [d for d in data["manual"] if d["id"] != eid]
        what = f"dividend {rs(x['dps'])} on {esc(x['code'])} ({x['xd']})"
    return f"↩️ Removed #{eid}: {what}.", True


def handle(text, data):
    text = (text or "").strip()
    if HOLD.match(text):
        return holdings_reply(data), False
    m = TRADES.match(text)
    if m:
        return trades_reply(data, m[1]), False
    m = UNDO.match(text)
    if m:
        return undo(m, data)
    m = TRADE.match(text)
    if m:
        return trade(m, data)
    m = DIV.match(text)
    if m:
        return div(m, data)
    return ("⚠️ I didn't understand that. Examples:\n<code>/buy COCR 200 95.20</code>\n<code>/buy COCR 200 95.20 11/27</code>\n"
            "<code>/sell DIAL 100 46 yesterday</code>\n<code>/holdings</code>  <code>/trades</code>  <code>/undo</code>"), False


def unseal(text):
    """The listener encrypts the command (AES-256-GCM with the PORTFOLIO_LINK_KEY secret, shared with
    the Cloudflare worker) because a workflow's inputs show in its public logs."""
    if not text.startswith("enc:"):
        return text
    import base64
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = base64.b64decode(os.environ.get("PORTFOLIO_LINK_KEY", ""))
    _, iv, ct = text.split(":", 2)
    return AESGCM(key).decrypt(base64.b64decode(iv), base64.b64decode(ct), None).decode("utf-8")


def main():
    import telegram
    text = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        text = unseal(text)
    except Exception:
        text = "/?"  # can't read it: reply with the examples, never echo the sealed text
    message_id = sys.argv[2] if len(sys.argv) > 2 else ""
    changed = False
    try:
        data = ps.load()
        reply, changed = handle(text, data)
        if changed:
            ps.save(data)
    except ps.LockedError as e:
        reply = f"🔒 {esc(e)}"
    print(re.sub(r"<[^>]+>", "", reply) if not os.environ.get("GITHUB_ACTIONS") else "Reply sent to the channel.")
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
