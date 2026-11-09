# Broker summary format (`broker/<YYYY-MM-DD>.json`)

One file per day. The "Broker updates" page (`broker.html`) shows them, newest
first, and the build posts the newest one to Telegram once. Raw posts collected
from the Telegram channel are in `inbox/<date>/` (see `scripts/broker_collect.py`).

All numbers are plain numbers. Leave out anything the messages don't give.

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `date` | Summary date (Sri Lanka), e.g. `"2026-11-10"` |
| `source` | Broker name, e.g. `"HNB Stockbrokers"` |
| `posts` | Number of messages summarised |
| `messageIds` | Telegram message ids summarised (from `inbox/*/messages.json`), so nothing is summarised twice |
| `callsPriceDate` | Date of the prices in the broker's recommendation table |
| `note` | Caveats, e.g. figures read from small images |
| `highlights` | 3–5 short sentences: the day's most important points |
| `market` | `aspi`, `aspiChangePct`, `aspiPoints`, `sp20`, `sp20ChangePct`, `turnoverBn` (Rs bn), `marketPE`, `marketPBV`, `marketCapTn`, `foreignBuyMn`, `foreignSellMn`, `foreignNetMn` (Rs mn, negative = net selling), `gainers` / `losers` (codes that moved the index), `foreignFlows` (`[{code, mn}]`), `momentum` (`[{code, pct}]`) |
| `calls` | `[{code, name, sector, price, rating, target}]`. `code` is the full CSE code (`SAMP.N0000`, `HNB.X0000`) so the page can match companies on the site. `rating` as the broker writes it: `Buy`, `Moderate buy`, `Hold`, `Sell`. `target` is `null` when the broker shows TBA. |
| `dividends` | `[{code, name, dps, type, price, yieldPct, xd, pay}]` (dates as `YYYY-MM-DD`) |
| `news` | `[{title, text}]`, short and in my own words |

Example: `broker/2026-11-09.json`.
