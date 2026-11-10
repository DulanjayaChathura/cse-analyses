# CSE share analyses: working notes for Claude

This repository is a static website (GitHub Pages) that shows long-term valuation analyses of Colombo Stock Exchange shares. The owner is a long-term investor. The usual question is how many shares to buy (often 500) and at what price.

## Main files
- `data/<CODE>.json`: the current analysis shown on the site. Format: `docs/json-format.md`. Example: `data/DIAL.N0000.json`.
- `research/<CODE>/record.json`: the research record (figures per period, valuation inputs, open questions, change log). Format: `docs/research-format.md`.
- Report PDFs are **not** in this repository. They live on the owner's laptop in `cse-research\<folder>\` (one folder per company, e.g. `dialog`, `sampath bank`), reached through the Claude desktop app's folder connection. The folder name for each company is saved as `localFolder` in its `record.json`; ask the owner if a new company's folder isn't clear.
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
   - Then rewrite `data/<CODE>.json` in the same format: new `analysisDate`, `resultsCovered`, `price`, `summary`, `valuation`, `keyMetrics`, `highlights`, `history`, `models`, `scenarios`, `sensitivity`, `buyPlan`, `changeMyView`, `quality`, and `fullText`.
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

## Daily broker summary
Broker messages (HNB Stockbrokers, forwarded from WhatsApp) are posted to the Telegram channel. Every day at 13:45 Saudi time (16:15 Sri Lanka) the "Collect broker messages" workflow saves new posts to `inbox/<date>/messages.json`, with full-size images in `inbox/<date>/files/`. A scheduled Claude task runs at 14:00 Saudi time (16:30 Sri Lanka) and then:
1. Find posts not yet summarised: every message in `inbox/*/messages.json` whose id isn't in any `broker/*.json` `messageIds`. If there are none, stop.
2. Read every text and look at every image (recommendation tables, market snapshot, dividend cards, news). Never invent a figure; if one can't be read, leave it out and say so in `note`.
3. Write `broker/<today>.json` following `docs/broker-format.md`: highlights first, then market, every broker call (full CSE codes), dividends, news. Paraphrase; don't copy long passages.
4. Run `python scripts/build_site.py`, commit to `main` and push. The build publishes the page and posts the short version to Telegram.
5. Don't change any company's analysis because of a broker call. Mention big disagreements in the highlights instead.

## Rules
- Never invent a figure. If something can't be found, use `null`, add a note, and mention it in the pull request.
- Numbers in JSON are plain numbers (42, not "Rs 42").
- This is analysis, not personal financial advice. Keep the disclaimer in `notes.disclaimer`.
