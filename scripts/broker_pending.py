"""Work out which broker posts each /summary command covers.

The owner posts "/summary" (or "/summary12", "/summary-12") in the Telegram channel
when they want a summary. broker_collect.py saves those posts with a "command" mark.
Each command covers the posts between the previous summary command and itself:

  /summary      → summary filed under the command's own date (Sri Lanka time); a command
                  sent between midnight and 08:00 Sri Lanka time files under the day before,
                  since it's still about the previous trading day. The summary run then checks
                  the reports' own date (e.g. "Market close as at 19 Nov") and uses that if
                  it differs, saying so in the summary's note.
  /summary12    → summary filed under the 12th of the command's month
                  (or of the previous month, if the 12th is still to come)

"/summary12 redo" (or "/summary redo") covers the same posts (those since the previous summary
command) but replaces that day's summary instead of adding to it ("redo": true in the output).

A command is done once it is recorded in inbox/summary_commands.json (written by
--done below; also accepted: its id in the "commands" list of a broker/<date>.json file).
The first command ever (no earlier command) covers every post after the newest post
already summarised.

  python scripts/broker_pending.py         prints the pending commands as JSON
  python scripts/broker_pending.py --text  prints a readable list
  python scripts/broker_pending.py --done <commandId> <date|none> [posts]
                                           records a command as handled

Output: {"pending": [{"commandId", "command", "commandTime", "date", "dateNote",
         "messageIds", "posts", "afterCommandId"}]}, oldest command first.
"""
import datetime
import json
import sys

from common import ROOT, read_json, write_json


def load_messages():
    messages = {}
    for path in sorted((ROOT / "inbox").glob("*/messages.json")):
        folder = path.parent.name
        for m in read_json(path, {}).get("messages", []):
            m = dict(m, folder=folder)
            messages[m["id"]] = m
    return [messages[k] for k in sorted(messages)]


DONE = ROOT / "inbox" / "summary_commands.json"


def load_done():
    summarised, commands = set(), set()
    commands.update(int(k) for k in read_json(DONE, {}).get("done", {}))
    for path in (ROOT / "broker").glob("*.json"):
        b = read_json(path, {})
        summarised.update(b.get("messageIds") or [])
        commands.update(b.get("commands") or [])
    return summarised, commands


EARLY_HOURS = 8   # a plain /summary sent before 08:00 Sri Lanka time is about the day before


def target_date(cmd):
    when = datetime.date.fromisoformat(cmd["time"][:10])
    day = (cmd.get("command") or {}).get("day")
    if not day:
        hour = int(cmd["time"][11:13]) if len(cmd["time"]) >= 13 else 12
        if hour < EARLY_HOURS:
            prev = when - datetime.timedelta(days=1)
            return prev.isoformat(), f"Sent at {cmd['time'][11:16]} Sri Lanka time, so filed under the day before ({prev.isoformat()})."
        return when.isoformat(), None
    y, m = when.year, when.month
    for _ in range(2):
        try:
            d = datetime.date(y, m, day)
        except ValueError:
            d = None
        if d and d <= when:
            note = None if (y, m) == (when.year, when.month) else f"The {day}th hadn't come yet this month, so the previous month was used."
            return d.isoformat(), note
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return None, f"Day {day} isn't a valid date for this month or the previous one."


def pending():
    messages = load_messages()
    summarised, done = load_done()
    commands = [m for m in messages if m.get("command")]
    posts = [m for m in messages if not m.get("command")]
    out = []
    for i, cmd in enumerate(commands):
        if cmd["id"] in done:
            continue
        if i > 0:
            start = commands[i - 1]["id"]
        else:
            start = max([x for x in summarised if x < cmd["id"]], default=0)
        window = [p for p in posts if start < p["id"] < cmd["id"] and p["id"] not in summarised]
        date, note = target_date(cmd)
        redo = bool((cmd.get("command") or {}).get("redo"))
        out.append({
            "commandId": cmd["id"],
            "command": cmd["text"].strip(),
            "commandTime": cmd["time"],
            "date": date,
            "dateNote": note,
            "afterCommandId": commands[i - 1]["id"] if i > 0 else None,
            "redo": redo,
            "messageIds": [p["id"] for p in window],
            "posts": [{"id": p["id"], "folder": p["folder"], "time": p["time"],
                       "files": [f"inbox/{p['folder']}/{f}" for f in p.get("files") or []],
                       "links": [dict(l, **{k: f"inbox/{p['folder']}/{l[k]}" for k in ("file", "textFile") if l.get(k)})
                                 for l in p.get("links") or []]} for p in window],
        })
    return out


def mark_done(command_id, date, posts):
    log = read_json(DONE, {"done": {}})
    log.setdefault("done", {})[str(command_id)] = {
        "date": None if date in (None, "none") else date,
        "posts": posts,
        "handled": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
    }
    log["done"] = dict(sorted(log["done"].items(), key=lambda kv: int(kv[0])))
    write_json(DONE, log)
    print(f"Recorded /summary command {command_id} as handled.")


def main():
    if "--done" in sys.argv:
        args = sys.argv[sys.argv.index("--done") + 1:]
        mark_done(int(args[0]), args[1] if len(args) > 1 else None, int(args[2]) if len(args) > 2 else None)
        return 0
    result = pending()
    if "--text" in sys.argv:
        if not result:
            print("No pending /summary commands.")
        for r in result:
            print(("REDO (replace the day's summary with one made from these posts only) " if r["redo"] else "") +
                  f"{r['command']} (message {r['commandId']}, {r['commandTime']}) → broker/{r['date']}.json: "
                  f"{len(r['messageIds'])} post(s) {r['messageIds']}" + (f"  NOTE: {r['dateNote']}" if r["dateNote"] else ""))
            for post in r["posts"]:
                for f in post["files"]:
                    print(f"    post {post['id']} file: {f}")
                for l in post["links"]:
                    print(f"    post {post['id']} link: {l['url']} → " + (l.get("textFile") or l.get("file") or f"{l['status']}: {l.get('error', '')}"))
        return 0
    print(json.dumps({"pending": result}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
