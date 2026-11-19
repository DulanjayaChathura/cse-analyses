# Broker summary format (`broker/<YYYY-MM-DD>.json`)

One file per day: the trading day the posts are about (see CLAUDE.md and `scripts/broker_pending.py`). The "Broker updates" page (`broker.html`) shows them, newest
first, and the build posts the newest one to Telegram once. Raw posts collected
from the Telegram channel are in `inbox/<date>/` (see `scripts/broker_collect.py`).

All numbers are plain numbers. Leave out anything the messages don't give.

| Field | Meaning |
|---|---|
| `schemaVersion` | `2` (summaries written before 19 Nov 2026 are `1` and have no `coverage` or `research`) |
| `date` | Summary date (Sri Lanka), e.g. `"2026-11-10"` |
| `source` | Broker name, e.g. `"HNB Stockbrokers"` |
| `posts` | Number of messages summarised |
| `messageIds` | Telegram message ids summarised (from `inbox/*/messages.json`), so nothing is summarised twice |
| `commands` | Ids of the `/summary` command posts this summary answers (see `scripts/broker_pending.py`) |
| `callsPriceDate` | Date of the prices in the broker's recommendation table |
| `note` | Caveats, e.g. figures read from small images |
| `highlights` | 3–5 short sentences: the day's most important points |
| `coverage` | **Required.** What was read: `[{post, kind, title, items: [{item, status, reason}]}]`, one entry per post summarised (`kind`: `pdf`, `image`, `text`, `link`). `items` lists every section, table and chart in it (each tile, table, chart, paragraph topic); `status` is `included`, `approx` (read off a chart without figures) or `left-out`, which needs a `reason`. `scripts/validate_broker.py` refuses a summary without it, and the site won't publish it. |
| `research` | The broker's research reports (earnings notes, sector or market reports, budget reviews): `[{code, company, report, date, rating, prevRating, target, price, priceDate, keyPoints[], forecasts[], risks[], catalysts[], post}]`. `code` is the full CSE code or `null`; `keyPoints` 3–5 short points (what drove the result, the call's reasoning); `forecasts` their estimates (`"FY27E EPS Rs 12.33"`); `risks` and `catalysts` at most 3 each, as the report gives them. Shown as cards near the top, next to this site's fair value. |
| `market` | `aspi`, `aspiChangePct`, `aspiPoints`, `sp20`, `sp20ChangePct`, `turnoverBn` (Rs bn), `marketPE`, `marketPBV`, `marketCapTn`, `foreignBuyMn`, `foreignSellMn`, `foreignNetMn` (Rs mn, negative = net selling), `gainers` / `losers` (codes that moved the index), `foreignFlows` (`[{code, mn, approx}]`, `approx: true` when read off a chart without figures), `momentum` (`[{code, pct}]`), `other` (`[{label, value, unit}]`: any other market figure the reports give, such as dividend yield or index points, so nothing is dropped for lack of a field) |
| `calls` | `[{code, name, sector, price, rating, target}]`. `code` is the full CSE code (`SAMP.N0000`, `HNB.X0000`) so the page can match companies on the site. `rating` as the broker writes it: `Buy`, `Moderate buy`, `Hold`, `Sell`. `target` is `null` when the broker shows TBA. |
| `dividends` | `[{code, name, dps, type, price, yieldPct, xd, pay}]` (dates as `YYYY-MM-DD`) |
| `news` | `[{title, text}]`, short and in my own words |

Example: `broker/2026-11-09.json`.
