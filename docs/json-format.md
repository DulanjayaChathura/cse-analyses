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
| `valuation` | `{fairValue, buyPrice, strongBuyPrice, marginOfSafety{buy,strongBuy}, scenarioWeights{bear,base,bull}, nav, note}` | Price bar, badges, % above or below fair value. |
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
