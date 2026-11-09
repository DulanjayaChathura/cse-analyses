"""Save new posts from the Telegram channel into inbox/ for the daily broker summary.

Runs once a day at 15:00 Sri Lanka time (.github/workflows/broker.yml).
The bot is an admin of the channel, so Telegram gives it every post, including
messages forwarded from WhatsApp, as "channel_post" updates. Telegram keeps
these for about 24 hours, so one run a day is enough.

Saved to:
  inbox/<YYYY-MM-DD>/messages.json   one entry per post (text, time, forwarded-from, files)
  inbox/<YYYY-MM-DD>/files/          full-size photos and documents
  inbox/last_update_id.txt           the last update saved; the next run asks
                                     Telegram only for newer ones, which also
                                     tells Telegram it can drop the older ones

The site's own posts (price alerts, research and broker summaries) are skipped.
"""
import datetime
import json
import os
import sys
import urllib.request

import cse
import telegram
from common import ROOT, read_json, write_json

INBOX = ROOT / "inbox"
LAST_ID = INBOX / "last_update_id.txt"
MAX_FILE = 20 * 1024 * 1024        # the Bot API can't download larger files
OWN_PREFIXES = ("🔔", "📊", "📋", "📄", "✅ Test")   # messages this site posts itself


def colombo_time(ts):
    return datetime.datetime.fromtimestamp(ts, cse.COLOMBO).isoformat(timespec="minutes")


def same_chat(chat, wanted):
    wanted = str(wanted).strip()
    return str(chat.get("id")) == wanted or ("@" + (chat.get("username") or "")).lower() == wanted.lower()


def forwarded_from(post):
    o = post.get("forward_origin") or {}
    if o.get("type") == "user":
        u = o.get("sender_user") or {}
        return " ".join(x for x in [u.get("first_name"), u.get("last_name")] if x) or None
    if o.get("type") == "hidden_user":
        return o.get("sender_user_name")
    if o.get("type") in ("chat", "channel"):
        return (o.get("chat") or o.get("sender_chat") or {}).get("title")
    return None


def download(file_id, dest_dir, name):
    """Download a photo or document; returns its path relative to the day folder, or None."""
    info = telegram.call("getFile", {"file_id": file_id})
    if not info or not info.get("file_path") or (info.get("file_size") or 0) > MAX_FILE:
        return None
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    ext = os.path.splitext(info["file_path"])[1] or ""
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / (name if name.endswith(ext) or not ext else name + ext)
    with urllib.request.urlopen(f"{telegram.API}/file/bot{token}/{info['file_path']}", timeout=60) as r:
        target.write_bytes(r.read())
    return f"files/{target.name}"


def main():
    if not telegram.configured():
        print("::error::TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set.")
        return 1
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    last = int(LAST_ID.read_text().strip()) if LAST_ID.exists() else 0
    params = {"timeout": "0", "allowed_updates": json.dumps(["channel_post"])}
    if last:
        params["offset"] = str(last + 1)
    updates = telegram.call("getUpdates", params) or []

    day = cse.today_colombo()
    day_dir = INBOX / day
    path = day_dir / "messages.json"
    saved = read_json(path, {"date": day, "messages": []})
    seen = {m["id"] for m in saved["messages"]}
    new, skipped, newest = 0, 0, last

    for u in updates:
        newest = max(newest, u["update_id"])
        post = u.get("channel_post")
        if not post or not same_chat(post.get("chat", {}), chat_id):
            continue
        text = post.get("text") or post.get("caption") or ""
        if text.startswith(OWN_PREFIXES) or post["message_id"] in seen:
            skipped += 1
            continue
        files = []
        try:
            if post.get("photo"):
                biggest = max(post["photo"], key=lambda p: p.get("width", 0) * p.get("height", 0))
                f = download(biggest["file_id"], day_dir / "files", f"{post['message_id']}")
                files.append(f) if f else None
            if post.get("document"):
                doc = post["document"]
                f = download(doc["file_id"], day_dir / "files", f"{post['message_id']}-{doc.get('file_name', 'file')}")
                files.append(f) if f else None
        except Exception as e:
            print(f"::warning::Couldn't download the file in post {post['message_id']}: {e}")
        saved["messages"].append({
            "id": post["message_id"],
            "time": colombo_time(post["date"]),
            "forwardedFrom": forwarded_from(post),
            "album": post.get("media_group_id"),
            "text": text,
            "files": files,
        })
        seen.add(post["message_id"])
        new += 1

    if new:
        saved["messages"].sort(key=lambda m: m["id"])
        write_json(path, saved)
    if newest != last:
        INBOX.mkdir(exist_ok=True)
        LAST_ID.write_text(f"{newest}\n")
    print(f"Saved {new} new post(s) to inbox/{day}/ ({skipped} skipped as the site's own or already saved).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
