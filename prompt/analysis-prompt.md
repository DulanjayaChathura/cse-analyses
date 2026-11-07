# Prompt for claude.ai

Upload the annual report and the latest quarterly report PDFs, then paste everything
between the two lines below. Change the company name and share code on the first line.

---

Dialog Axiata PLC (CSE code DIAL.N0000). I'm a long-term investor planning to buy 500 shares. Use all methods (NAV, ROE, P/E, dividends, DCF or residual income, etc.), give bear/base/bull, show assumptions and what would change them, and tell me the buy price. Start with a short summary, then a table. Look up the latest share price and say the date it's from.

When the analysis is finished, also create a downloadable file named exactly `<CSE code>.json` (for example `DIAL.N0000.json`) that follows the structure below. Rules for the file:

- Return valid JSON only inside the file, no comments.
- Numbers must be plain numbers (42, not "Rs 42"; 12.5, not "12.5x"). Use null for anything unknown or not meaningful (such as P/E in a loss year). Never use 0 for "unknown".
- Dates must be YYYY-MM-DD.
- Per-share values are in rupees. Amounts in `keyMetrics` use the unit "Rs bn" for billions.
- `ticker` is the main (voting) share code. If the company also has non-voting shares (.X0000), list both in `shareClasses`.
- `fiscalYearEnd` is the company's financial year end as "MM-DD" (e.g. "12-31" or "03-31").
- `resultsCovered.periodEnd` is the end date of the latest financial period used.
- `verdict` must be one of: "strong-buy", "buy", "fair", "overpriced".
- Keep the same number of entries in `history.values` and `history.notes` as in `history.periods`.
- Put the complete written analysis (summary, tables as text, assumptions, risks) in `fullText`.
- Keep every field name exactly as shown. Leave out a section only if it truly doesn't apply.

```json
{
  "schemaVersion": 1,
  "ticker": "XXXX.N0000",
  "company": { "name": "Company Name PLC", "sector": "Sector", "fiscalYearEnd": "12-31" },
  "shareClasses": [ { "symbol": "XXXX.N0000", "label": "Voting" } ],
  "analysisDate": "YYYY-MM-DD",
  "resultsCovered": { "label": "First half of 2026 (six months to 30 June 2026)", "periodEnd": "YYYY-MM-DD", "audited": false, "sources": ["Annual report 2025", "Interim report to 30 June 2026"] },
  "price": { "value": 0.0, "date": "YYYY-MM-DD", "source": "where the price came from", "note": "optional context" },
  "summary": { "verdict": "overpriced", "headline": "one-line verdict", "text": "the short summary paragraph" },
  "valuation": { "fairValue": 0.0, "buyPrice": 0.0, "strongBuyPrice": 0.0, "marginOfSafety": { "buy": 15, "strongBuy": 25 }, "scenarioWeights": { "bear": 30, "base": 50, "bull": 20 }, "nav": 0.0, "note": "how fair value was weighted" },
  "keyMetrics": [
    { "id": "nav", "label": "NAV per share", "value": 0.0, "unit": "Rs", "note": "optional" },
    { "id": "pnav", "label": "Price to NAV", "value": 0.0, "unit": "x" },
    { "id": "pe", "label": "P/E (trailing)", "value": 0.0, "unit": "x" },
    { "id": "roe", "label": "Return on equity (12 months)", "value": 0.0, "unit": "%" },
    { "id": "dividendYield", "label": "Dividend yield", "value": 0.0, "unit": "%" },
    { "id": "payout", "label": "Payout ratio", "value": 0.0, "unit": "%" },
    { "id": "fcfYield", "label": "FCF yield", "value": 0.0, "unit": "%", "display": "optional text such as 11–12%" },
    { "id": "marketCap", "label": "Market cap", "value": 0.0, "unit": "Rs bn" },
    { "id": "netDebt", "label": "Net debt", "value": 0.0, "unit": "Rs bn" }
  ],
  "highlights": [ { "title": "Latest results", "text": "what happened" } ],
  "history": {
    "periods": ["2022", "2023", "2024", "2025", "Last 12 months"],
    "series": [
      { "id": "roe", "label": "Return on equity", "unit": "%", "values": [null, 0, 0, 0, 0], "notes": ["Loss year", null, null, null, null] },
      { "id": "pe", "label": "P/E", "unit": "x", "values": [null, 0, 0, 0, 0], "notes": [null, null, null, null, null] }
    ]
  },
  "methodReadings": [ { "method": "NAV", "value": "Rs 0.00", "reading": "what this method says" } ],
  "models": [ { "id": "dcf", "name": "Free cash flow to equity DCF", "bear": 0.0, "base": 0.0, "bull": 0.0, "weighted": 0.0, "comment": "optional" } ],
  "modelsNote": "why these methods suit (or don't suit) this company",
  "scenarios": {
    "assumptions": [ { "label": "Growth", "bear": "text", "base": "text", "bull": "text" } ],
    "averages": { "bear": 0.0, "base": 0.0, "bull": 0.0 },
    "common": "assumptions shared by all cases"
  },
  "sensitivity": { "title": "DCF base case, Rs per share", "rowLabel": "Cost of equity", "columnLabel": "Long-term growth", "rows": ["15%", "17%", "19%"], "columns": ["4%", "5%", "6%"], "values": [[0, 0, 0], [0, 0, 0], [0, 0, 0]], "base": { "row": 1, "column": 1 }, "note": "what the table shows" },
  "buyPlan": { "totalShares": 500, "tiers": [ { "shares": 200, "maxPrice": 0.0 } ], "averagePrice": 0.0, "totalCost": 0, "note": "comparison with buying now", "realism": "how likely the buy price is" },
  "changeMyView": { "higher": ["what would support a higher value"], "lower": ["what would support a lower value"] },
  "notes": { "disclaimer": "data caveats" },
  "fullText": "the complete written analysis"
}
```

---
