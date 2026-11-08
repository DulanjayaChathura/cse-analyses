# CSE share analyses: working notes for Claude

This repository is a static website (GitHub Pages) that shows long-term valuation analyses of Colombo Stock Exchange shares. The owner is a long-term investor. The usual question is how many shares to buy (often 500) and at what price.

## Main files
- `data/<CODE>.json`: the current analysis shown on the site. Format: `docs/json-format.md`. Example: `data/DIAL.N0000.json`.
- `research/<CODE>/record.json`: the research record (figures per period, valuation inputs, open questions, change log). Format: `docs/research-format.md`.
- `research/<CODE>/reports/`: report PDFs uploaded by the owner.
- `research/<CODE>/history/<analysisDate>.json`: archived earlier analyses.
- `alerts.json`: the owner's Telegram price targets. Don't change it unless asked.
- `generated/`: written by GitHub Actions. Never edit by hand.

## Updating a company from a new report

Follow these steps whenever the owner says a new report was uploaded (or runs `/update <CODE>`).

1. **Read the record first.** Read `research/<CODE>/record.json` and `data/<CODE>.json`. Don't re-read reports already listed in `reportsRead` unless a figure needs checking.
2. **Find what's new.** List `research/<CODE>/reports/`. A PDF whose path isn't in `reportsRead[].file` is new. If nothing is new, say so and stop.
3. **Read only the new reports.** Extract the standard figures (`docs/research-format.md`) for the new period. Record each figure with its source as report name and page, e.g. "Interim Q3 2026, p. 4". For quarterly reports, note whether figures are for the quarter or year-to-date.
4. **Check restatements.** If the new report restates an earlier period's figure, correct it in `periods` and add a note saying it was restated and the old value.
5. **Answer the open questions** in the record, using the new figures.
6. **Re-run the valuation.**
   - Use every method in the current analysis: NAV, ROE, P/E, dividends, DCF or residual income, and so on, with bear, base and bull cases.
   - Keep `valuationInputs` unless the new data clearly justifies a change. For each change, update `value`, write the reason, and set `since` to today.
   - Look up the latest share price with web search, and say where it's from and its date.
7. **Archive, then update the analysis.**
   - Copy the current `data/<CODE>.json` to `research/<CODE>/history/<its analysisDate>.json`, if not already there.
   - Then rewrite `data/<CODE>.json` in the same format: new `analysisDate`, `resultsCovered`, `price`, `summary`, `valuation`, `keyMetrics`, `highlights`, `history`, `models`, `scenarios`, `sensitivity`, `buyPlan`, `changeMyView`, and `fullText`.
   - Keep the same writing style: short summary first, then tables, plain language.
8. **Update the record.**
   - Add the new period to `periods`, and add the report to `reportsRead` (with `file`, `readOn`).
   - Replace `openQuestions` with what to watch next.
   - Set `updated`.
   - Append a `changeLog` entry with: what changed and why; the new fair value, buy and strong-buy prices; the price at the time; and the archive path.
9. **Check.** Run `python scripts/validate.py data/<CODE>.json`. It must pass with no errors and ideally no warnings. Also run `python scripts/build_site.py` and make sure it completes.
10. **Deliver.** Commit on a new branch named `update-<code>-<period>` (e.g. `update-dial-q3-2026`) and open a pull request. In the pull request description, say:
    - fair value, buy price and strong-buy price, old → new, and why;
    - the main new figures;
    - any assumption changes and restatements;
    - anything uncertain, such as a figure that couldn't be found or a page that couldn't be read.

## A new company (first analysis)
Read all PDFs in `research/<CODE>/reports/`. Write a full `data/<CODE>.json` following `docs/json-format.md`, and a new `record.json` with every report in `reportsRead` and every period's figures. Then do steps 9–10.

## Rules
- Never invent a figure. If something can't be found, use `null`, add a note, and mention it in the pull request.
- Numbers in JSON are plain numbers (42, not "Rs 42").
- This is analysis, not personal financial advice. Keep the disclaimer in `notes.disclaimer`.
