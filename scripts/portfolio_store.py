#!/usr/bin/env python3
"""The owner's portfolio, kept encrypted in the public repository (portfolio.enc.json).

Only scrambled text is stored. It is locked with AES-256-GCM under a key made from the
owner's passphrase with PBKDF2-SHA256 (310,000 rounds, a fresh random salt and nonce on
every save). The passphrase is the GitHub secret PORTFOLIO_KEY; the site's portfolio page
asks for the same passphrase and unlocks the file in the browser (Web Crypto), so the
format here must match assets/js/portfolio.js.

What is inside (plain JSON once unlocked):
  {"version": 1, "updated": "...",
   "trades": [{"id": 1, "d": "2026-11-27", "code": "COCR.N0000", "side": "buy",
               "n": 200, "p": 95.2, "fees": 213.25, "added": "..."}],
   "dividends": {"COCR.N0000": [{"id": 38250, "dps": 7.0, "xd": "2026-09-02", "pay": "2026-09-17",
                                 "note": "FINAL DIVIDEND ..."}]},
   "manual": [{"id": 2, "code": "...", "dps": 1.5, "xd": "...", "pay": "...", "note": "..."}],
   "dividendsChecked": "2026-11-28T..."}

Dividends of the companies held are read from the CSE's own announcements (fetch_dividends
in this module) and saved inside the encrypted file, because a public list of the companies
whose dividends are tracked would show what the owner holds.
"""
import base64
import datetime
import json
import os
import re
import secrets

from common import ROOT

FILE = ROOT / "portfolio.enc.json"
ROUNDS = 310_000
FEE_RATE = 0.0112      # CSE transaction cost up to Rs 100mn (brokerage 0.64%, CSE, CDS, SEC, 0.30% levy)
DIV_TAX = 0.15         # dividend tax withheld at source (confirm against the first real dividend slip)


class LockedError(Exception):
    pass


def _key(passphrase, salt):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ROUNDS)
    return kdf.derive(passphrase.encode("utf-8"))


def passphrase():
    p = os.environ.get("PORTFOLIO_KEY", "")
    if not p:
        raise LockedError("The PORTFOLIO_KEY secret isn't set, so the portfolio can't be unlocked.")
    return p


def empty():
    return {"version": 1, "updated": None, "trades": [], "dividends": {}, "manual": [], "dividendsChecked": None}


def load(key=None):
    """The unlocked portfolio, or an empty one if the file doesn't exist yet."""
    if not FILE.exists():
        return empty()
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    box = json.loads(FILE.read_text(encoding="utf-8"))
    salt, iv, ct = (base64.b64decode(box[k]) for k in ("salt", "iv", "data"))
    try:
        plain = AESGCM(_key(key or passphrase(), salt)).decrypt(iv, ct, None)
    except Exception:
        raise LockedError("The passphrase doesn't unlock portfolio.enc.json.")
    data = json.loads(plain.decode("utf-8"))
    base = empty()
    base.update(data)
    return base


def save(data, key=None):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    data["updated"] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    ct = AESGCM(_key(key or passphrase(), salt)).encrypt(iv, json.dumps(data, ensure_ascii=False).encode("utf-8"), None)
    box = {
        "format": "AES-256-GCM, key from PBKDF2-SHA256",
        "rounds": ROUNDS,
        "salt": base64.b64encode(salt).decode(),
        "iv": base64.b64encode(iv).decode(),
        "data": base64.b64encode(ct).decode(),
        "note": "The owner's portfolio, encrypted. Unlock it on the site's Portfolio page with the passphrase.",
    }
    FILE.write_text(json.dumps(box, indent=1) + "\n", encoding="utf-8")


def next_id(data):
    ids = [t.get("id", 0) for t in data["trades"]] + [m.get("id", 0) for m in data["manual"]]
    return max(ids, default=0) + 1


# ---------------- holdings ----------------

def holdings(data, upto=None):
    """{code: {"shares", "cost", "realised", "first"}} from the trades, by average cost (fees in)."""
    pos = {}
    for t in sorted(data["trades"], key=lambda t: (t["d"], t["id"])):
        if upto and t["d"] > upto:
            continue
        h = pos.setdefault(t["code"], {"shares": 0, "cost": 0.0, "realised": 0.0, "first": t["d"]})
        if t["side"] == "buy":
            h["cost"] += t["n"] * t["p"] + t["fees"]
            h["shares"] += t["n"]
        else:
            avg = h["cost"] / h["shares"] if h["shares"] else 0
            h["realised"] += t["n"] * t["p"] - t["fees"] - avg * t["n"]
            h["cost"] -= avg * t["n"]
            h["shares"] -= t["n"]
    return pos


def shares_on(data, code, day):
    """Shares of `code` held at the close of the trading day before `day` (i.e. trades dated before it)."""
    n = 0
    for t in data["trades"]:
        if t["code"] == code and t["d"] < day:
            n += t["n"] if t["side"] == "buy" else -t["n"]
    return max(n, 0)


def dividend_events(data):
    """Every dividend that applies to the trades: CSE announcements plus manual entries.
    You get one if you held the shares at the close of the day before the XD date."""
    out = []
    for code, rows in (data.get("dividends") or {}).items():
        for r in rows:
            out.append(dict(r, code=code, source="cse"))
    for m in data.get("manual") or []:
        out.append(dict(m, source="manual"))
    for e in out:
        e["shares"] = shares_on(data, e["code"], e["xd"]) if e.get("xd") else 0
        e["net"] = e["shares"] * e["dps"] * (1 - DIV_TAX)
    return [e for e in out if e["shares"] > 0]


# ---------------- CSE dividend announcements ----------------

def _iso(day):
    try:
        return datetime.datetime.strptime(day.strip(), "%d %b %Y").date().isoformat()
    except Exception:
        return None


def fetch_dividends(data, codes=None, quiet=False):
    """Read the CSE's cash-dividend announcements for the companies traded and save them in `data`.
    Returns how many new dividends were found. Network problems are reported, not raised."""
    import cse
    codes = sorted(codes or {t["code"] for t in data["trades"]})
    known = data.setdefault("dividends", {})
    new = 0
    for code in codes:
        try:
            r = cse.post("getAnnouncementByCompany", {"symbol": code})
        except Exception as e:
            if not quiet:
                print(f"::warning::Dividends for one holding couldn't be read this time ({type(e).__name__}).")
            continue
        rows = (r or {}).get("reqCompanyAnnouncement") or []
        have = {d["id"] for d in known.get(code, [])}
        nonvoting = code.endswith(".X0000")
        for a in rows:
            if (a.get("announcementCategory") or "").strip().upper() != "CASH DIVIDEND":
                continue  # "(DATES TO BE NOTIFIED)" comes back later as a full CASH DIVIDEND notice
            aid = a.get("announcementId")
            if aid in have:
                continue
            try:
                det = (cse.post("getAnnouncementById", {"announcementId": str(aid)}) or {}).get("reqBaseAnnouncement") or {}
            except Exception:
                continue
            dps = det.get("nonVotingDivPerShare") if nonvoting else det.get("votingDivPerShare")
            if not isinstance(dps, (int, float)) or dps <= 0:
                dps = det.get("divPerShare")
            xd, pay = _iso(det.get("xd") or ""), _iso(det.get("payment") or "")
            if not isinstance(dps, (int, float)) or dps <= 0 or not xd:
                continue
            known.setdefault(code, []).append({"id": aid, "dps": float(dps), "xd": xd, "pay": pay,
                                               "note": re.sub(r"\s+", " ", det.get("remarks") or "").strip()[:160]})
            new += 1
        known.get(code, []).sort(key=lambda d: d["xd"])
    data["dividendsChecked"] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    return new
