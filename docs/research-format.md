# Research record format (`research/<CODE>/record.json`)

The research record keeps everything worth carrying forward between analyses, so an update only needs to read new reports.

| Field | What it holds |
|---|---|
| `schemaVersion` | Always `1`. |
| `ticker` | The main share code, e.g. `"DIAL.N0000"`. |
| `updated` | Date of the last update, `YYYY-MM-DD`. |
| `reportsRead` | Every report already read: `{file, title, period, periodEnd, type ("annual" or "interim"), audited, readOn, note}`. `file` is the path in `reports/`, or `null` if the PDF isn't in the repository. |
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
