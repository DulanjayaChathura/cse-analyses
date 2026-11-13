# CSE share analyses: working notes for Claude

This repository is a static website (GitHub Pages) that shows long-term valuation analyses of Colombo Stock Exchange shares. The owner is a long-term investor. The usual question is how many shares to buy (often 500) and at what price.

## Main files
- `data/<CODE>.json`: the current analysis shown on the site. Format: `docs/json-format.md`. Example: `data/DIAL.N0000.json`.
- `research/<CODE>/record.json`: the research record (figures per period, valuation inputs, open questions, change log). Format: `docs/research-format.md`.
- Report PDFs for requests made from Telegram (`/update`, `/add`, `/redo … full`) are downloaded from the CSE into `reports/<CODE>/` (see "Research requests from Telegram"). Otherwise report PDFs are **not** in this repository: they live on the owner's laptop in `cse-research\<folder>\` (one folder per company, e.g. `dialog`, `sampath bank`), reached through the Claude desktop app's folder connection. The folder name for each company is saved as `localFolder` in its `record.json`; ask the owner if a new company's folder isn't clear.
- `research/<CODE>/history/<analysisDate>.json`: archived earlier analyses.
- `alerts.json`: the owner's Telegram price targets. Don't change it unless asked.
- `generated/`: written by GitHub Actions. Never edit by hand.

## The analysis brief (use for every first analysis and update)
The owner's standard request is: "I'm a long-term investor planning to buy 500 shares. Use all methods (NAV, ROE, P/E, dividends, DCF or residual income, etc.), give bear/base/bull, show assumptions and what would change them, and tell me the buy price. Start with a short summary, then a table."
- Weight scenarios bear 30 / base 50 / bull 20 unless there's a reason to change; buy price = fair value less 15%, strong buy = less 25%.
- Choose methods that suit the business: a cash-flow DCF for steady cash generators; for banks use NAV/P-B, ROE, P/E, dividends and residual income instead of a DCF.
- Include a 500-share buy plan in tiers, and say how realistic the buy price is given this year's trading range.
- Score the four business tests in `quality` (`docs/json-format.md`): return on equity of 15% or more, net debt no more than equity, steady profit, and profit turning into cash. Three passes make the business "good". The site turns this into a category: 1 buy now (good and at or below the buy price), 2 watch list (good, price too high), 3 avoid for now (fails the tests). Re-score the tests on every update and say in the hand-over if the category changed.

## Updating a company from a new report

Follow these steps whenever the owner says a new report was added to the laptop folder (or runs `/update <CODE>`).

1. **Read the record first.** Read `research/<CODE>/record.json` and `data/<CODE>.json`. Don't re-read reports already listed in `reportsRead` unless a figure needs checking.
2. **Find what's new.** List the company's folder on the laptop (`localFolder` in the record). A PDF whose name isn't in `reportsRead[].file` is new. If nothing is new, say so and stop.
3. **Read only the new reports.** Extract the standard figures (`docs/research-format.md`) for the new period. Record each figure with its source as report name and page, e.g. "Interim Q3 2026, p. 4". For quarterly reports, note whether figures are for the quarter or year-to-date.
4. **Check restatements.** If the new report restates an earlier period's figure, correct it in `periods` and add a note saying it was restated and the old value.
5. **Answer the open questions** in the record, using the new figures.
6. **Re-run the valuation.**
   - Use every method in the current analysis: NAV, ROE, P/E, dividends, DCF or residual income, and so on, with bear, base and bull cases.
   - Keep `valuationInputs` unless the new data clearly justifies a change. For each change, update `value`, write the reason, and set `since` to today.
   - Use the latest CSE close from `generated/prices.json` when it has the share; otherwise look up the price with web search and say where it's from and its date. Web price snapshots (e.g. Simply Wall St) can be weeks old, so prefer the CSE close.
7. **Archive, then update the analysis.**
   - Copy the current `data/<CODE>.json` to `research/<CODE>/history/<its analysisDate>.json`, if not already there.
   - Then rewrite `data/<CODE>.json` in the same format: new `analysisDate`, `resultsCovered`, `price`, `summary`, `valuation`, `dividend` (latest dividend per share, plus any newer interim declared), `keyMetrics`, `highlights`, `history`, `models`, `scenarios`, `sensitivity`, `buyPlan`, `changeMyView`, `quality`, and `fullText`.
   - Keep the same writing style: short summary first, then tables, plain language.
8. **Update the record.**
   - Add the new period to `periods`, and add the report to `reportsRead` (with `file`, `readOn`).
   - Replace `openQuestions` with what to watch next.
   - Set `updated`.
   - Append a `changeLog` entry with: what changed and why; the new fair value, buy and strong-buy prices; the price at the time; and the archive path.
9. **Check.** Run `python scripts/validate.py data/<CODE>.json`. It must pass with no errors and ideally no warnings. Also run `python scripts/build_site.py` and make sure it completes.
10. **Deliver.** Commit straight to `main` (the owner asked for no pull requests) and push. The push starts the "Build and publish site" workflow, which republishes the site. Check that the run succeeds. If it fails, fix the problem and push again. Then tell the owner:
    - fair value, buy price and strong-buy price, old → new, and why;
    - the main new figures;
    - any assumption changes and restatements;
    - anything uncertain, such as a figure that couldn't be found or a page that couldn't be read.

## A new company (first analysis)
Read all PDFs in the company's laptop folder. Write a full `data/<CODE>.json` following `docs/json-format.md`, and a new `record.json` with every report in `reportsRead` and every period's figures. Then do steps 9–10.

## Research requests from Telegram (/update, /add, /redo)
The owner can ask for research by posting a command in the Telegram channel. The listener starts the "Research request" workflow (`research-request.yml`), which runs `scripts/research_request.py check`: it checks the code with the CSE, downloads the reports needed into `reports/<CODE>/` (at most 4; `reports/<CODE>/index.json` lists them), queues the request in `research/requests.json`, replies in the channel, and starts the "Research on request" Claude task. Repeated commands for a company that's already queued, codes that don't exist, and updates with no new report are answered in the channel without starting Claude. A request still `pending` (never picked up, e.g. because starting Claude failed) is started again when the same command is repeated after 3 minutes. When you begin a request, nothing marks it as started, so check `research/requests.json` again before pushing in case two runs overlap.

| Command | Mode | What to do |
|---|---|---|
| `/update DIAL [note]` | `update` | Follow "Updating a company from a new report", reading the downloaded files instead of the laptop folder. |
| `/add COMB [n] [note]` | `add` | Follow "A new company (first analysis)" with the downloaded files (the latest annual report, or the last n, and the quarterlies after it). Set `localFolder` to `null`. |
| `/redo DIAL [note]` | `redo` | Redo the valuation from the saved research record: no reports. Re-check every assumption against the record's figures, use the latest CSE close, apply the current analysis brief and format (including any newer sections other analyses have), re-score the business tests, then archive and rewrite as in steps 7–10. |
| `/redo DIAL full [note]` | `redo-full` | Rebuild the research record and the analysis from the downloaded reports, as for a new company, keeping the record's `changeLog` and earlier `reportsRead`. Archive the old analysis first. |

To handle the requests:
1. `git pull`, then `python scripts/research_request.py list`. It shows each pending request with its mode, the owner's note and the report files. If there are none, stop.
2. Handle them oldest first. The owner's note (if any) says what to focus on or change; follow it unless it would mean inventing figures.
3. For downloaded reports, record `file` in `reportsRead` as the repository path (e.g. `reports/DIAL.N0000/2026-11-12_quarterly_Interim-Q3-2026.pdf`). If a report listed under "problem" couldn't be stored, say so in the change log and the hand-over.
4. In the `changeLog` entry, start the summary with how it was asked for, e.g. "Requested from Telegram (/redo DIAL: use 13% discount rate)."
5. Validate, build, commit to `main` and push as in steps 9–10, together with `python scripts/research_request.py done <id> "<one line: fair value old → new, buy price, category>"`. If a request can't be finished, run `python scripts/research_request.py failed <id> "<reason>"` (this tells the channel) and commit that.
6. The site build announces the new analysis in Telegram, so there's no need to post anything else.

## Broker summary (on demand, with /summary)
Broker messages (HNB Stockbrokers, forwarded from WhatsApp) are posted to the Telegram channel. The "Collect broker messages" workflow (`broker.yml`) saves new posts to `inbox/<date>/messages.json` (the date it collected them, Sri Lanka time), with full-size images in `inbox/<date>/files/`. It runs every day at 15:45 Saudi time so no post is lost (Telegram keeps them only about 24 hours), and also whenever a summary is requested.

The owner asks for a summary by posting a command in the channel:
- `/summary`: summarise every post since the previous summary command; file it under the command's own date.
- `/summary12` (also `/summary-12`, `/summary 12`): the same posts, filed under the 12th of the command's month (the previous month if the 12th hasn't come yet).
- `/summary12 redo` (or `/summary redo`): the same posts (since the previous summary command), but they replace that day's summary instead of being added to it. `broker_pending.py` marks it `REDO`.

The collector saves these commands with a `"command"` mark. They divide the posts: each command covers the posts after the previous command and before itself. Never treat a command as broker content.

To write the summaries:
1. Make sure the latest posts are collected (run `broker.yml` and wait for it), then `git pull`.
2. Run `python scripts/broker_pending.py --text` (or without `--text` for JSON). It lists every command not yet handled, oldest first, with its target date and the exact message ids it covers. Use only those ids; don't pick posts yourself.
3. For each pending command, in order:
   - If it covers no posts, run `python scripts/broker_pending.py --done <commandId> none 0` and move on.
   - Otherwise read every text and look at every image in its posts (recommendation tables, market snapshot, dividend cards, news). Never invent a figure; if one can't be read, leave it out and say so in `note`.
   - Write `broker/<date>.json` following `docs/broker-format.md`: highlights first, then market, every broker call (full CSE codes), dividends, news. Paraphrase; don't copy long passages. If the file already exists, merge the new posts into it, except for a `REDO` command: then replace the whole file with a summary of the listed posts only (its `messageIds` become just those posts; keep only its earlier `commands` list). Add the message ids to `messageIds` and the command's id to `commands`.
   - Run `python scripts/broker_pending.py --done <commandId> <date> <number of posts>`.
4. Run `python scripts/build_site.py`, commit to `main` and push. The build publishes the page and posts the short version to Telegram.
5. Don't change any company's analysis because of a broker call. Mention big disagreements in the highlights instead.

## Rules
- Never invent a figure. If something can't be found, use `null`, add a note, and mention it in the pull request.
- Numbers in JSON are plain numbers (42, not "Rs 42").
- This is analysis, not personal financial advice. Keep the disclaimer in `notes.disclaimer`.
