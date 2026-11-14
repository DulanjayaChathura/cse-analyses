# Research record format (`research/<CODE>/record.json`)

The research record keeps everything worth carrying forward between analyses, so an update only needs to read new reports.

| Field | What it holds |
|---|---|
| `schemaVersion` | Always `1`. |
| `ticker` | The main share code, e.g. `"DIAL.N0000"`. |
| `localFolder` | The company's folder name inside `cse-research` on the owner's laptop, e.g. `"sampath bank"`. |
| `updated` | Date of the last update, `YYYY-MM-DD`. |
| `reportsRead` | Every report already read: `{file, title, period, periodEnd, type ("annual" or "interim"), audited, readOn, note}`. `file` is the PDF's file name in the laptop folder, its repository path (`reports/<CODE>/…pdf`) when it was downloaded for a Telegram request, or `null` if unknown. |
| `periods` | Figures per period, oldest first: `{period, periodEnd, months, type, audited, figures}`. Each figure is `{value, unit, source, note}`; `source` names the report and page, e.g. `"Interim Q3 2026, p. 4"`. `value` is `null` if unknown. |
| `valuationInputs` | Assumptions used in the valuation: `{name, value, reason, since}`. Change one only with a stated reason, and update `since`. |
| `openQuestions` | Things to check in the next report. |
| `changeLog` | One entry per analysis, oldest first: `{date, basedOn, summary, fairValue, buyPrice, strongBuyPrice, priceAtTime, archive}`. |

## Standard figure names

Use these names where they apply, so periods can be compared:

- `revenue`, `grossProfit`, `grossMarginPct`, `netProfit`, `eps`
- `dividendPerShare`, `navPerShare`, `roe`, `peYearEnd`
- `operatingCashFlow`, `capexPaid`, `freeCashFlow`
- `netDebt`, `netDebtToEbitda`, `debtToEquity`, `sharesOutstanding`
- `fxGainLoss`, `contractedCapex`

You can add others when a company needs them (e.g. `netInterestMargin` for a bank).

Units: `"Rs bn"`, `"Rs mn"`, `"Rs"` (per share), `"%"`, `"x"`, or `""`.

## Reinvestment figures (companies that aren't banks, finance companies or insurers)

Record these from every annual report, in Rs bn, so capex, growth and R&D can be checked (`scripts/reinvestment.py` reads them). If a report doesn't give one, set `value` to `null` with a note such as "not disclosed"; never estimate it.

- `capexPaid`: cash paid for property, plant and equipment and intangible assets (cash flow statement).
- `depreciation`: depreciation and amortisation for the year (cash flow statement or notes).
- `maintenanceCapex`: only when the company itself says how much of its capex keeps the business running (as opposed to expanding it). Leave it out otherwise; depreciation is then used in its place.
- `workingCapitalChange`: the increase in working capital (stock, receivables less payables) in the year, from the cash flow statement. Positive means cash was tied up; negative means cash was released.
- `acquisitions`: cash paid for subsidiaries, associates or other business stakes, net of cash acquired.
- `operatingProfit`: profit from operations, before finance costs and tax.
- `taxRate`: the effective tax rate, in %.
- `totalEquity`: equity attributable to the owners of the company.
- `rdExpensed`, `rdCapitalised`, `rdAsset`: research and development charged to profit in the year; development costs capitalised as an intangible in the year; and the capitalised development balance at year end (the LKAS 38 note). Look for them in every annual report; most Sri Lankan companies don't disclose R&D, which is fine: `null`, "not disclosed".

Saved assumptions (`valuationInputs`) that go with them:

- `Maintenance capex basis`: `"depreciation"` (the default stand-in) or `"company split"`, with the reason.
- `R&D life`: years over which R&D keeps paying off (default 3 for tech and telecom, 5 for manufacturing and others, 10 for pharma), only when R&D is material.
- `Growth check`: the growth each scenario assumes against the growth the company's reinvestment supports, and the reason for any scenario more than 2 percentage points above it, e.g. `"Assumed 3% / 6% / 8%; supported 5.4%. Bull 2.6 pts above: the new kiln is built and starts in 2027."`
