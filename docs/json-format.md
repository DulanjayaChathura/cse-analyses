# Analysis file format (schemaVersion 1)

One file per company, saved in the `data/` folder and named after the main share code,
for example `data/DIAL.N0000.json`. A new file for the same company simply replaces the old one.

`data/DIAL.N0000.json` is a complete, working example. Copy its structure.

## General rules

- **Numbers are plain numbers**: `42`, `9.68`, `95.5` — never `"Rs 42"` or `"12.5x"`.
  The `unit` field says how to show them.
- **Unknown values are `null`**, never `0` and never left out of a list
  (lists such as `history.values` must keep one entry per period).
- **Dates are `YYYY-MM-DD`**, for example `2026-06-30`.
- **Text fields** may use `**bold**`, blank lines for new paragraphs, and lines starting with `- ` for bullet lists.
- Extra sections the site doesn't know are allowed. They're shown under "Other details".

## What happens when a file has a problem

| Problem | Result |
|---|---|
| Not valid JSON, missing `schemaVersion`, `ticker` or `analysisDate`, or the ticker doesn't match the filename | **Rejected.** The site keeps showing the previous valid version, and GitHub emails you. |
| A section is missing or has the wrong shape (e.g. a number written as text) | **Accepted.** That section shows "Not available in this analysis", and GitHub emails you a warning. |

## Required fields

| Field | Example | Meaning |
|---|---|---|
| `schemaVersion` | `1` | Always 1 for this format. |
| `ticker` | `"DIAL.N0000"` | Main CSE share code. Must match the filename. |
| `analysisDate` | `"2026-10-26"` | The day the analysis was made. |

## Sections

| Section | Shape | Shown as |
|---|---|---|
| `company` | `{name, sector, fiscalYearEnd}`; `fiscalYearEnd` is `"MM-DD"`, e.g. `"12-31"` or `"03-31"` | Name (only used if the CSE name can't be fetched) and the results-due warning. |
| `shareClasses` | `[{symbol, label}]`, e.g. `[{"symbol":"DIAL.N0000","label":"Voting"},{"symbol":"DIAL.X0000","label":"Non-voting"}]` | Prices for each class on the card and the company page. |
| `resultsCovered` | `{label, periodEnd, audited, sources[]}` | "Based on…" line, and the "newer results are probably out" warning. |
| `price` | `{value, date, source, note}` | Analysis price; the daily CSE close replaces it when newer. |
| `summary` | `{verdict, headline, text}`; `verdict` is one of `"strong-buy"`, `"buy"`, `"fair"`, `"overpriced"` | Verdict header. |
| `quality` | `{rating, passed, outOf, reason, assessed, tests: [{id, label, pass, value, note}]}`. Four tests: `returns` (return on equity of 15% or more, judged over several years), `debt` (net debt no more than equity; for a bank, capital comfortably above the minimum), `steady` (no loss in five years and no reliance on one-offs), `cash` (profit turns into cash and dividends). `rating` is `"good"` when at least 3 pass, else `"weak"`. | Category on the cards and the "Business tests" section. The site works out the category from `rating` and the latest price: 1 = good and a share class at or below the buy price; 2 = good, price above the buy price; 3 = weak. |
| `shareholders` | `{asOf, compareTo, source, takeaway, groups[{name, pct}], publicFloat, publicHolders, publicHoldersPrev, directors[{name, shares}], top[{name, shares, pct, change, new, note}], gone[{name, prevShares}]}`. From the latest report's shareholder notes (top 20, directors' holdings, public holding). `change` = shares bought (+) or sold (−) since `compareTo`, `null` with `new: true` for a holder not in the previous top 20; `gone` = holders that dropped out. `groups`: the parent and any other big holders, plus "Public", for the ownership bar. `takeaway`: one or two sentences on who controls the company and the biggest moves. `note` explains anything odd, such as a renamed holder. Percentages and names exactly as the report gives them. | "Shareholders" section on the company page. |
| `management` | `{asOf, source, takeaway, said[{text, ref}], plans[{text, ref}], investing[{text, amount, ref}], track[{promise, result, status, ref}]}`. From the Chairman's and CEO's messages (and the strategy/outlook pages) of the latest annual report. `takeaway`: one sentence, the point that matters most to a long-term investor. `said`, `plans`, `investing`: at most 5 short points each, paraphrased, with the page (`ref`); `investing[].amount` is the sum and period as stated ("USD 100m over 2 years"), or `null`. `track`: at most 6 of last year's promises (or this year's, while the next annual report isn't out) against what the figures show, `status` one of `done`, `on-track`, `missed`, `too-early`. | "Management and plans" box in the Overview (tabs on a phone). |
| `valuation.textFigures` | Optional `{fairValue, buyPrice, strongBuyPrice, asOf, why}`: the figures the written text still quotes after the numbers were corrected without a rewrite (e.g. a formula fix). Removed by the next update or redo. | A note on the company page that the written analysis has older figures. |
| `modelInputs` | The numbers behind each recalculable method, so the site's "What if?" panel can redo them: `{costOfEquity{bear, base, bull}, wacc{...}, debtWeight, shares (millions), netDebt (Rs bn), dcf{years, bear{start, nopat, growth, longRun, roc, maintenance, stableRoc?}, base, bull}, pe{bear{eps, roe, longRun} or {eps, pe}, ...}, ddm{years, bear{dividend, eps, growth, roe, longRun}, ...}, ri{years, book, payout, roeStart, bear{roe, longRun}, ...}, pb{book, bear{roe, longRun}, ...}}`. Rates in %, `dividend` and `eps` are next year's. In `ddm`, `roe` is the long-run ROE: after the growth years the payout becomes 1 − longRun ÷ roe (Damodaran's stable payout), so `eps` and `roe` are required. `modelInputs.derive` maps a field path to how code fills it from the research record, e.g. `{"netDebt": "latest.netDebt", "dcf.base.nopat": "ttm.operatingProfit * (1 - annual.taxRate / 100)", "dcf.base.start": {"calc": "ttm.cashBeforeInterest - maintenance - 4.5", "basis": "valuationInputs: Cash after maintenance capex (start)"}}` (names: `scripts/derived.py`). Any plain number in a formula is an assumption, so that entry needs a `basis` naming the `valuationInputs` entry that explains it. Run `scripts/derived.py CODE --write` to fill the fields; the validator checks they match. Each method may carry `basis`: `{field: "valuationInputs: <name>" or "periods: <period>.<figure>"}`, naming the research-record entry a value comes from; the validator checks it exists (required for `ddm`). In `dcf`, the optional `stableRoc` is the return on capital after the growth years (Damodaran usually sets it near WACC); without it the growth-period `roc` continues. Include only the methods the analysis uses. A sum of the parts (`sotp`) that is a DCF of the main business plus other pieces (joint ventures, projects, investments) saves the DCF inputs under `dcf` and the other pieces as `dcf.addOn`, in Rs a share, with `addOnNote` naming them; the panel recalculates the DCF and adds the pieces unchanged. NAV and other sums of the parts stay as published. Write it with `scripts/valuation.py CODE inputs.json --write`, which also fills the matching `models` values. If the inputs don't reproduce the published values, the validator warns and the panel is hidden. | "What if?" section on the company page. |
| `requiredReturn` | `{beta, betaBasis, riskFree, matureERP, countryPremium, costOfEquity{bear, base, bull}, costOfDebt, wacc{bear, base, bull}, debtWeight, asOf, sources[], note}`; all rates in %; `costOfDebt`, `wacc` and `debtWeight` are `null` for banks, finance companies and insurers. Copy the figures from `scripts/reinvestment.py`. | "Required return" tile on the company page, with the beta; hovering shows how it's built up. If the saved 10-year bond rate (`research/market-inputs.json`) has since changed, the site build shifts the cost of equity and WACC by the change in the risk-free rate and recalculates the code-computed methods; the page notes it (`_rate` in the built copy only). |
| `valuation` | `{fairValue, buyPrice, strongBuyPrice, marginOfSafety{buy,strongBuy}, scenarioWeights{bear,base,bull}, nav, note}` | Price bar, badges, % above or below fair value. |
| `dividend` | `{perShare, label, source, note?, latest?{perShare, label, source}}`; `perShare` in rupees (`null` if not known). `label` says which dividend, e.g. `"for 2025/26"`, `"final for 2025"`, `"paid June 2026"`. Use the latest full-year figure; add `latest` when a newer interim has been declared for the current year (e.g. `"interim for 2026/27"`). Only reported per-share figures, never one worked out from a total. | "Dividend per share" line on the home-page card. |
| `keyMetrics` | `[{id, label, value, unit, display?, note?}]`; `unit` is `"Rs"`, `"Rs bn"`, `"Rs mn"`, `"x"`, `"%"` or `""`; `display` overrides the shown text (e.g. `"11–12%"`) | Key figures cards. |
| `highlights` | `[{title, text}]` | "Latest results" panel. |
| `history` | `{periods[], series[{id, label, unit, values[], notes[]}]}` | ROE and P/E history charts (`null` = not meaningful). |
| `methodReadings` | `[{method, value, reading}]` | "What each method says" table. |
| `models` | `[{id, name, bear, base, bull, weighted, comment?}]` (Rs per share) | Valuation methods chart. |
| `modelsNote` | text | Note under the chart. |
| `scenarios` | `{assumptions[{label, bear, base, bull}], averages{bear, base, bull}, common}`; assumption cells are text | Assumptions table. |
| `sensitivity` | `{title, rowLabel, columnLabel, rows[], columns[], values[[...]], base{row, column}, note}` | Sensitivity heatmap. |
| `buyPlan` | `{totalShares, tiers[{shares, maxPrice}], averagePrice, totalCost, note, realism}` | Buy plan. |
| `changeMyView` | `{higher[], lower[]}` | "What would change the view". |
| `notes` | `{disclaimer}` | Shown above the full text. |
| `fullText` | the complete readable report, as text | "Full analysis" section. |
