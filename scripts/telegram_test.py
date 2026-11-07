"""Help set up Telegram: list the channels the bot can see, and send a test message.

Run from the Actions tab: "Test Telegram" -> Run workflow.
"""
import os
import sys

import telegram


def main():
    if not os.environ.get("TELEGRAM_BOT_TOKEN"):
        print("::error::The TELEGRAM_BOT_TOKEN secret is missing. Add it under Settings -> Secrets and variables -> Actions.")
        return 1
    try:
        me = telegram.call("getMe")
        print(f"Bot found: @{me.get('username')}")
    except Exception as e:
        print(f"::error::The bot token doesn't work: {e}")
        return 1

    # Channel IDs, for private channels (post any message in the channel first).
    try:
        seen = {}
        for u in telegram.call("getUpdates", {"allowed_updates": '["channel_post","my_chat_member"]'}) or []:
            chat = (u.get("channel_post") or {}).get("chat") or (u.get("my_chat_member") or {}).get("chat")
            if chat and chat.get("type") == "channel":
                seen[chat["id"]] = chat.get("title")
        for cid, title in seen.items():
            print(f"Channel found: '{title}'  ->  TELEGRAM_CHAT_ID = {cid}")
        if not seen:
            print("No channels seen yet. Add the bot to your channel as an admin, post any message there, then run this again.")
    except Exception as e:
        print(f"::warning::Couldn't list channels: {e}")

    if not os.environ.get("TELEGRAM_CHAT_ID"):
        print("::warning::TELEGRAM_CHAT_ID isn't set yet, so no test message was sent. Copy the ID above into that secret and run again.")
        return 0
    try:
        telegram.send("✅ Test from your CSE share analyses site. Alerts will arrive in this channel.")
        print("Test message sent. Check the channel.")
        return 0
    except Exception as e:
        print(f"::error::Couldn't send to the channel: {e}. Check the chat ID, and that the bot is an admin allowed to post messages.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
