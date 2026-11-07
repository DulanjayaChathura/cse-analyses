"""Send messages with the Telegram Bot API.

Needs two GitHub Secrets, passed in as environment variables:
  TELEGRAM_BOT_TOKEN  the token from @BotFather
  TELEGRAM_CHAT_ID    the channel, e.g. @mychannel or -1001234567890
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("TELEGRAM_API", "https://api.telegram.org")  # overridable for tests


def configured():
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN")) and bool(os.environ.get("TELEGRAM_CHAT_ID"))


def call(method, params=None, retries=2):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    body = urllib.parse.urlencode(params or {}).encode()
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(f"{API}/bot{token}/{method}", data=body, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode("utf-8"))
            if d.get("ok"):
                return d.get("result")
            raise RuntimeError(d.get("description", "unknown Telegram error"))
        except urllib.error.HTTPError as e:
            try:
                last = RuntimeError(json.loads(e.read().decode("utf-8")).get("description", str(e)))
            except Exception:
                last = e
            if e.code in (400, 401, 403, 404):  # wrong token, chat or permissions: retrying won't help
                break
        except Exception as e:
            last = e
        time.sleep(2 * (attempt + 1))
    # Never include the token in error messages.
    raise RuntimeError(f"Telegram {method} failed: {str(last).replace(token, '***') if token else last}")


def send(text):
    return call("sendMessage", {
        "chat_id": os.environ["TELEGRAM_CHAT_ID"],
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    })
