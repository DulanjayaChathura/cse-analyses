"""Save new posts from the Telegram channel into inbox/ for the broker summaries.

Runs once a day at 15:45 Saudi time / 18:15 Sri Lanka time (.github/workflows/broker.yml).
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

The owner's commands "/summary" and "/summary<day>" (e.g. "/summary12") are saved
too, marked with "command": {"day": <day or null>}. They mark where each broker
summary ends: see scripts/broker_pending.py.

Links in a post (e.g. a tinyurl.com link to the broker's Daily Market Update or an earnings
note) are followed here, because this job can reach the internet and the summary run can't:
the PDF or page is saved to inbox/<date>/files/links/ and the post gets
"links": [{url, finalUrl, file, textFile, type, status, error}]. Social media links are skipped.

  python scripts/broker_collect.py                   collect new posts (and their links)
  python scripts/broker_collect.py --links-since D   fetch links again for posts saved from day D
                                                     (YYYY-MM-DD) on that don't have them yet
"""
import datetime
import html.parser
import json
import os
import re
import sys
import urllib.parse
import urllib.request

import cse
import telegram
from common import ROOT, read_json, write_json

INBOX = ROOT / "inbox"
LAST_ID = INBOX / "last_update_id.txt"
MAX_FILE = 20 * 1024 * 1024        # the Bot API can't download larger files
OWN_PREFIXES = ("🔔", "📊", "📋", "📄", "✅ Test", "⏳", "⚠️")   # messages this site (and the listener) posts itself
# "/summary", "/summary12", "/summary-12", "/summary 12", "/summary@SomeBot": a summary command.
# Add " redo" ("/summary12 redo") to rewrite that day's summary from all its posts.
COMMAND = re.compile(r"^/summary(?:[-\s]?(\d{1,2}))?(?:@\w+)?(?:\s+(redo))?$", re.IGNORECASE)


def command_of(text):
    """{"day": 12} for "/summary12", {"day": None} for "/summary", {"day": 12, "redo": True}
    for "/summary12 redo", else None."""
    m = COMMAND.match(text.strip())
    if not m:
        return None
    out = {"day": int(m.group(1)) if m.group(1) else None}
    if m.group(2):
        out["redo"] = True
    return out


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


# ---------- Links ----------
URL = re.compile(r"https?://[^\s<>\"')\]]+")
SKIP_HOSTS = ("instagram.com", "facebook.com", "fb.com", "fb.watch", "youtube.com", "youtu.be", "twitter.com",
              "x.com", "linkedin.com", "tiktok.com", "wa.me", "whatsapp.com", "t.me", "telegram.me")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def safe(url):
    """Encode spaces and other characters urllib refuses (as cse.download does)."""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(parts._replace(path=urllib.parse.quote(parts.path, safe="/%"),
                                                  query=urllib.parse.quote(parts.query, safe="=&%")))


def links_in(text, entities=None):
    """Every URL in a post: written out in the text, or hidden behind linked words."""
    found = [u.rstrip(".,;:") for u in URL.findall(text or "")]
    for e in entities or []:
        if e.get("type") == "text_link" and e.get("url"):
            found.append(e["url"])
    out = []
    for u in found:
        if u not in out:
            out.append(u)
    return out


def direct_url(url):
    """Google Drive / Docs share links → a direct download."""
    m = re.search(r"drive\.google\.com/(?:file/d/|open\?id=|uc\?id=)([\w-]+)", url)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    m = re.search(r"docs\.google\.com/(document|spreadsheets|presentation)/d/([\w-]+)", url)
    if m:
        return f"https://docs.google.com/{m.group(1)}/d/{m.group(2)}/export?format=pdf"
    return url


class _Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg"):
            self.skip += 1
        elif tag in ("p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def page_text(raw):
    p = _Text()
    p.feed(raw.decode("utf-8", "replace"))
    text = re.sub(r"[ \t]+", " ", "".join(p.parts))
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def fetch_link(url, dest_dir, stem):
    """Download one link. Returns the record saved on the post."""
    rec = {"url": url}
    host = re.sub(r"^www\.", "", urllib.parse.urlsplit(url).netloc.lower())
    if any(host == h or host.endswith("." + h) for h in SKIP_HOSTS):
        return dict(rec, status="skipped", error="social media link")
    try:
        req = urllib.request.Request(safe(direct_url(url)), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            final, ctype = r.geturl(), (r.headers.get("Content-Type") or "").lower()
            data = r.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            return dict(rec, finalUrl=final, status="failed", error="larger than 20 MB")
        # Google Drive answers big files with a "can't scan for viruses" page; follow its confirm link once.
        if "drive.google.com" in final and b"confirm=" in data[:200000] and "html" in ctype:
            m = re.search(rb'href="(/uc\?export=download[^"]+confirm=[^"]+)"', data)
            if m:
                link = "https://drive.google.com" + m.group(1).decode().replace("&amp;", "&")
                with urllib.request.urlopen(urllib.request.Request(link, headers={"User-Agent": UA}), timeout=60) as r:
                    final, ctype, data = r.geturl(), (r.headers.get("Content-Type") or "").lower(), r.read(MAX_FILE + 1)
        rec["finalUrl"] = final
        dest_dir.mkdir(parents=True, exist_ok=True)
        if data[:5] == b"%PDF-" or "pdf" in ctype:
            target = dest_dir / f"{stem}.pdf"
            target.write_bytes(data)
            return dict(rec, file=f"files/links/{target.name}", type="pdf", status="saved")
        if "html" in ctype or data.lstrip()[:15].lower().startswith((b"<!doctype", b"<html")):
            target = dest_dir / f"{stem}.html"
            target.write_bytes(data)
            text = dest_dir / f"{stem}.txt"
            text.write_text(page_text(data), encoding="utf-8")
            return dict(rec, file=f"files/links/{target.name}", textFile=f"files/links/{text.name}", type="html", status="saved")
        ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(ctype.split(";")[0].strip(), ".bin")
        target = dest_dir / f"{stem}{ext}"
        target.write_bytes(data)
        return dict(rec, file=f"files/links/{target.name}", type=ctype.split(";")[0].strip() or "unknown", status="saved")
    except Exception as e:
        return dict(rec, status="failed", error=str(e)[:200])


def fetch_links(entry, entities, day_dir):
    urls = links_in(entry.get("text"), entities)
    if not urls:
        return
    entry["links"] = [fetch_link(u, day_dir / "files" / "links", f"{entry['id']}-{i + 1}") for i, u in enumerate(urls)]
    for l in entry["links"]:
        print(f"  post {entry['id']}: {l['url']} → {l['status']}{' ' + l.get('file', '') if l.get('file') else ''}{' (' + l['error'] + ')' if l.get('error') else ''}")


def links_since(day):
    """Fetch links for posts saved on or after `day` that don't have them yet."""
    n = 0
    for path in sorted(INBOX.glob("*/messages.json")):
        if path.parent.name < day:
            continue
        saved = read_json(path, {})
        changed = False
        for m in saved.get("messages", []):
            if "links" in m or m.get("command") or not links_in(m.get("text")):
                continue
            fetch_links(m, None, path.parent)
            changed, n = True, n + 1
        if changed:
            write_json(path, saved)
    print(f"Fetched the links of {n} post(s) saved since {day}.")
    return 0


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--links-since":
        return links_since(sys.argv[2])
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
        # Other commands (/update, /add, /redo, …) are for the research requests, not broker news.
        if text.strip().startswith("/") and not post.get("photo") and not post.get("document") and not command_of(text):
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
        entry = {
            "id": post["message_id"],
            "time": colombo_time(post["date"]),
            "forwardedFrom": forwarded_from(post),
            "album": post.get("media_group_id"),
            "text": text,
            "files": files,
        }
        cmd = command_of(text) if not files else None
        if cmd:
            entry["command"] = cmd
        else:
            fetch_links(entry, post.get("entities") or post.get("caption_entities"), day_dir)
        saved["messages"].append(entry)
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
