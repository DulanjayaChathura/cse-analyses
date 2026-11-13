"""Research requests from Telegram: /update, /add and /redo.

The owner posts a command in the Telegram channel; the /summary listener (listener/worker.js)
starts the "Research request" workflow, which runs `check` below. `check` works out what the
command needs, downloads the company's reports from the CSE into reports/<CODE>/, queues the
request in research/requests.json and tells the channel. The workflow then starts the
"Research on request" Claude task, which runs `list`, does the work and marks each request
`done` (see CLAUDE.md, "Research requests from Telegram").

Commands (code: DIAL, DIAL.N0000 or COMB.X0000; several codes can be given, space- or
comma-separated; anything after the last code is a note for Claude, shared by all of them):
  /update DIAL [COMB ...] [note]   update each from reports published after its current analysis
  /add COMB [n] [note]             new company: latest annual report (or the last n, at most 3)
                                    and the quarterly reports after it; an existing company → /update
                                    (the [n] shorthand only applies with a single code)
  /redo DIAL [COMB ...] [note]        redo the valuation from the saved research record; no reports
  /redo DIAL [COMB ...] full [note]   redo everything from the reports (as /add)

Each code is queued and its reports downloaded separately; one Claude run then works through
every queued request (see CLAUDE.md), so a multi-code command costs one run, not one per code.

  python scripts/research_request.py check "<command text>" [message id]
        prints start=true|false to $GITHUB_OUTPUT
  python scripts/research_request.py list            pending requests, readable
  python scripts/research_request.py done <id> "<one-line result>"
  python scripts/research_request.py failed <id> "<reason>"
"""
import datetime
import html
import json
import os
import re
import sys

import cse
import telegram
from common import DATA, ROOT, read_json, write_json

REQUESTS = ROOT / "research" / "requests.json"
REPORTS = ROOT / "reports"
MAX_FILES = 4
MAX_BYTES = 95 * 1024 * 1024        # GitHub refuses files over 100 MB
STALE_HOURS = 6                      # a request still open after this is treated as abandoned
RETRY_AFTER_MINUTES = 3              # a repeated command retries starting Claude for a request still pending after this
MAX_CODES = 8                         # codes accepted from one command

COMMAND = re.compile(r"^/(update|add|redo)(?:@\w+)?\s+(.+)$", re.IGNORECASE | re.DOTALL)
CODE_TOKEN = re.compile(r"^[A-Z][A-Z0-9&]{0,9}(?:\.[A-Z]\d{4})?$")


def take_codes(rest):
    """Consume one or more CSE codes from the front of `rest` ('DIAL COMB.N0000, SAMP note…').
    An ordinary word (e.g. a note starting with "please check…") looks exactly like a short
    code, so only the very first token is taken on trust (handle_code then reports it as an
    unknown code if it turns out not to be one); every token after that is kept as a code only
    if it actually resolves to a real company, so the note can start with anything. Always
    stops at the reserved word 'full' or at MAX_CODES."""
    tokens = rest.split()
    codes, i = [], 0
    while i < len(tokens) and len(codes) < MAX_CODES:
        tok = tokens[i].rstrip(",").upper()
        if tok == "FULL" or not CODE_TOKEN.match(tok):
            break
        if codes and not resolve(tok)[0]:
            break
        codes.append(tok)
        i += 1
    return codes, " ".join(tokens[i:])


def now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)


def say(text, reply_to=None):
    """Post to the channel (starts with ⏳ or ⚠️ so the broker collector skips it)."""
    print(text)
    if not telegram.configured():
        return
    params = {"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": text, "parse_mode": "HTML",
              "disable_web_page_preview": "true", "disable_notification": "true"}
    if reply_to:
        params["reply_to_message_id"] = str(reply_to)
        params["allow_sending_without_reply"] = "true"
    try:
        telegram.call("sendMessage", params)
    except Exception as e:
        print(f"::warning::Couldn't post to Telegram: {e}")


def output(**kw):
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            for k, v in kw.items():
                f.write(f"{k}={v}\n")


def site_companies():
    """{symbol: main ticker} for every share class on the site."""
    out = {}
    for p in DATA.glob("*.json"):
        d = read_json(p, {})
        t = d.get("ticker") or p.stem
        for sc in d.get("shareClasses") or [{"symbol": t}]:
            if sc.get("symbol"):
                out[sc["symbol"].upper()] = t
        out[t.upper()] = t
    return out


def resolve(code):
    """Return (ticker, name, on_site) or (None, None, False) if the CSE doesn't know the code."""
    code = code.upper()
    on_site = site_companies()
    if code in on_site:
        t = on_site[code]
        return t, (read_json(DATA / f"{t}.json", {}).get("company") or {}).get("name") or t, True
    if "." not in code:
        for sym, t in on_site.items():
            if sym.split(".")[0] == code:
                return t, (read_json(DATA / f"{t}.json", {}).get("company") or {}).get("name") or t, True
        code += ".N0000"
    try:
        name, _, last, prev = cse.company_info(code)
    except Exception:
        name = None
    if not name:
        return None, None, False
    return code, cse.nice_name(name), False


def load_requests():
    return read_json(REQUESTS, {"requests": []})


def open_request(reqs, ticker):
    """An unfinished, recent request for the same company, if any."""
    for r in reqs["requests"]:
        if r["ticker"] != ticker or r["status"] not in ("pending", "in-progress"):
            continue
        try:
            age = now() - datetime.datetime.fromisoformat(r["requestedAt"])
        except ValueError:
            continue
        if age < datetime.timedelta(hours=STALE_HOURS):
            return r
    return None


def downloaded(ticker):
    return read_json(REPORTS / ticker / "index.json", {"reports": []})


def choose_reports(ticker, mode, annuals, analysis_date):
    """Pick the reports this request needs (at most MAX_FILES), oldest first."""
    reports = [r for r in cse.financial_reports(ticker) if r.get("url")]
    have = {r["id"] for r in downloaded(ticker)["reports"]}
    date = lambda r: r.get("date") or ""
    annual = sorted([r for r in reports if r["kind"] == "annual"], key=date)
    quarterly = sorted([r for r in reports if r["kind"] == "quarterly"], key=date)
    if mode == "update":
        new = [r for r in reports if date(r) > (analysis_date or "") and r["id"] not in have]
        new_annual = [r for r in new if r["kind"] == "annual"]
        if new_annual:
            last = max(new_annual, key=date)
            after = sorted([r for r in new if r["kind"] == "quarterly" and date(r) > date(last)], key=date)
            pick = [last] + after[-(MAX_FILES - 1):]
        else:
            pick = sorted([r for r in new if r["kind"] == "quarterly"], key=date)[-MAX_FILES:]
    else:  # add, redo-full: the annual report(s) always, then the newest quarterlies after them
        if not annual:
            pick = quarterly[-MAX_FILES:]
        else:
            keep = annual[-annuals:]
            after = [r for r in quarterly if date(r) > date(keep[-1])]
            pick = keep + (after[-(MAX_FILES - len(keep)):] if len(keep) < MAX_FILES else [])
    return sorted(pick, key=date), have


def slug(text):
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:60] or "report"


def download(ticker, reports, have):
    """Download into reports/<ticker>/; returns (saved file paths, problems)."""
    folder = REPORTS / ticker
    folder.mkdir(parents=True, exist_ok=True)
    index = downloaded(ticker)
    saved, problems = [], []
    for r in reports:
        existing = next((x for x in index["reports"] if x["id"] == r["id"]), None)
        if existing and (ROOT / existing["file"]).exists():
            saved.append(existing["file"])
            continue
        try:
            data, ctype = cse.download(r["url"])
        except Exception as e:
            problems.append(f"{r['title']}: download failed ({e})")
            continue
        if len(data) > MAX_BYTES:
            problems.append(f"{r['title']}: too large to store ({len(data) // (1024 * 1024)} MB); read it from {r['url']}")
            continue
        if not data.startswith(b"%PDF"):
            problems.append(f"{r['title']}: not a PDF ({ctype or 'unknown type'})")
            continue
        name = f"{r.get('date') or 'undated'}_{r['kind']}_{slug(r['title'])}.pdf"
        (folder / name).write_bytes(data)
        rel = f"reports/{ticker}/{name}"
        index["reports"] = [x for x in index["reports"] if x["id"] != r["id"]] + [{
            "id": r["id"], "kind": r["kind"], "title": r["title"], "date": r.get("date"),
            "url": r["url"], "file": rel, "bytes": len(data), "downloaded": now().isoformat(),
        }]
        saved.append(rel)
    index["reports"].sort(key=lambda x: x.get("date") or "")
    write_json(folder / "index.json", index)
    return saved, problems


def handle_code(verb, code, annuals, redo_full, note, text, message_id):
    """Queue one code's request. Returns (started, request id or None); posts its own reply."""
    ticker, name, on_site = resolve(code)
    if not ticker:
        say(f"⚠️ {html.escape(code.upper())} isn't a CSE company code I can find. Nothing was started.", message_id)
        return False, None

    if verb == "add":
        mode = "update" if on_site else "add"
    elif verb == "redo":
        mode = "redo-full" if redo_full else "redo"
    else:
        mode = "update"
    label = f"{html.escape(name)} ({ticker})"

    if mode in ("update", "redo", "redo-full") and not on_site:
        say(f"⚠️ {label} isn't on the site yet. Use /add {ticker.split('.')[0]} to add it.", message_id)
        return False, None

    reqs = load_requests()
    dup = open_request(reqs, ticker)
    if dup and dup["status"] == "pending" and now() - datetime.datetime.fromisoformat(dup["requestedAt"]) > datetime.timedelta(minutes=RETRY_AFTER_MINUTES):
        # Saved earlier, but Claude never picked it up (e.g. the start failed): start it again.
        say(f"⏳ {label} was already queued but hasn't started yet, so I'm starting it again.", message_id)
        return True, dup["id"]
    if dup:
        say(f"⏳ {label} is already queued ({dup['mode']}, requested {dup['requestedAt'][11:16]} UTC). Nothing new was started.", message_id)
        return False, None

    files, problems = [], []
    if mode != "redo":
        analysis_date = read_json(DATA / f"{ticker}.json", {}).get("analysisDate")
        try:
            pick, have = choose_reports(ticker, mode, annuals, analysis_date)
        except Exception as e:
            say(f"⚠️ Couldn't read the CSE report list for {label} ({html.escape(str(e))}). Try again later.", message_id)
            return False, None
        if not pick:
            if verb == "add" and on_site:
                msg = f"⏳ {label} is already on the site, so I treated this as /update: no new report since its analysis ({analysis_date}). Nothing was started."
            elif mode == "update":
                msg = f"⏳ No new report for {label} since its analysis ({analysis_date}). Nothing was started."
            else:
                msg = f"⚠️ The CSE lists no reports for {label}. Nothing was started."
            say(msg, message_id)
            return False, None
        files, problems = download(ticker, pick, have)
        if not files:
            say(f"⚠️ Couldn't download the reports for {label}: " + html.escape("; ".join(problems)), message_id)
            return False, None

    req = {
        "id": f"{now().strftime('%Y%m%d%H%M%S')}-{ticker.split('.')[0]}",
        "ticker": ticker, "name": name, "mode": mode, "command": text.strip(), "note": note,
        "files": files, "problems": problems, "messageId": message_id,
        "requestedAt": now().isoformat(), "status": "pending",
    }
    reqs["requests"].append(req)
    write_json(REQUESTS, reqs)

    what = {"update": "Update", "add": "First analysis", "redo": "Redo from saved research",
            "redo-full": "Full redo from the reports"}[mode]
    extra = "" if not files else f"\nReports: " + "; ".join(html.escape(f.rsplit('/', 1)[-1]) for f in files)
    if verb == "add" and on_site:
        what = "Already on the site, so: update"
    warn = "" if not problems else "\n⚠️ " + html.escape("; ".join(problems))
    say(f"⏳ {what} started for {label}. The result will appear on the site and here when done "
        f"(about {'15–40' if mode in ('add', 'redo-full') else '10–25'} minutes).{extra}{warn}", message_id)
    return True, req["id"]


def check(text, message_id=None):
    m = COMMAND.match(text.strip())
    if not m:
        say(f"⚠️ I didn't understand <code>{html.escape(text[:60])}</code>. Use /update CODE, /add CODE or /redo CODE.", message_id)
        output(start="false")
        return 0
    verb, rest = m.group(1).lower(), m.group(2).strip()
    codes, rest = take_codes(rest)
    if not codes:
        say(f"⚠️ I didn't understand <code>{html.escape(text[:60])}</code>. Use /update CODE, /add CODE or /redo CODE.", message_id)
        output(start="false")
        return 0

    annuals = 1
    if verb == "add" and len(codes) == 1:
        n = re.match(r"^(\d)\b\s*(.*)$", rest, re.DOTALL)
        if n:
            annuals, rest = max(1, min(3, int(n.group(1)))), n.group(2).strip()
    redo_full = False
    if verb == "redo":
        fm = re.match(r"^full\b\s*(.*)$", rest, re.IGNORECASE | re.DOTALL)
        if fm:
            redo_full, rest = True, fm.group(1).strip()
    note = rest.strip() or None

    started_any, first_id = False, None
    for code in codes:
        started, req_id = handle_code(verb, code, annuals, redo_full, note, text, message_id)
        started_any = started_any or started
        first_id = first_id or req_id

    output(start="true", request=first_id) if started_any else output(start="false")
    return 0


def list_pending():
    reqs = load_requests()
    pending = [r for r in reqs["requests"] if r["status"] in ("pending", "in-progress")]
    if not pending:
        print("No pending research requests.")
    for r in pending:
        print(f"{r['id']}: {r['mode']} {r['ticker']} ({r['name']}), requested {r['requestedAt']}, status {r['status']}")
        print(f"   command: {r['command']}")
        if r.get("note"):
            print(f"   owner's note: {r['note']}")
        for f in r.get("files") or []:
            print(f"   report: {f}")
        for p in r.get("problems") or []:
            print(f"   problem: {p}")
    return 0


def finish(rid, status, result):
    reqs = load_requests()
    for r in reqs["requests"]:
        if r["id"] == rid:
            r["status"], r["result"], r["finishedAt"] = status, result, now().isoformat()
            write_json(REQUESTS, reqs)
            print(f"{rid}: {status}")
            if status == "failed":
                say(f"⚠️ {html.escape(r['name'])} ({r['ticker']}): the {r['mode']} couldn't be finished. {html.escape(result)}", r.get("messageId"))
            return 0
    print(f"No request {rid}.")
    return 1


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "check":
        return check(args[1], args[2] if len(args) > 2 and args[2] else None)
    if args[0] == "list":
        return list_pending()
    if args[0] in ("done", "failed") and len(args) >= 3:
        return finish(args[1], args[0], args[2])
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
