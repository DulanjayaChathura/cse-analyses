# Ratio ranges: what's normal, and when to explain

Check every ratio an analysis uses against this table. A figure outside its range isn't wrong by itself, but the analysis must say in one sentence why it's right for this company. Ranges marked **house rule** are this site's own limits, not published ones.

## Inputs to the valuation

| Ratio | Normal range | When outside | Source |
|---|---|---|---|
| Beta (levered) | 0.3 – 2.0 | Recheck the data; explain | House rule. Damodaran's sector betas (`betaEmerg`, January each year) mostly fall in 0.5–1.5. |
| Risk-free rate (rupee) | bond yield − default spread | — | Damodaran, *Country Risk* (annual, July): local-currency bond yield less the country's default spread. |
| Country premium | default spread × volatility factor (about 1.5) | — | Damodaran, *Country Risk* (2026 edition). |
| Cost of equity | about 12% – 22% for CSE shares (with beta 0.4–1.4 on today's inputs) | Explain; check the beta | Follows from the formula and `research/market-inputs.json`. |
| WACC | at or below the cost of equity | WACC above cost of equity means a sign error | Definition (debt costs less than equity after tax). |
| Long-run growth | below the 10-year bond yield, and below WACC | Not allowed | Damodaran, *Investment Valuation* (stable growth can't exceed the economy's nominal growth; the risk-free rate stands in for it). |
| Long-run reinvestment | growth ÷ return on capital, never 0 | Not allowed | Damodaran, *Investment Valuation*: g = reinvestment rate × return on capital. |
| Supported growth | reinvestment rate × return on capital (banks: share of profit kept × ROE) | More than 2 points above needs a reason | Same; the 2-point tolerance is a **house rule**. |
| Value from after the growth years (DCF) | under 75% | Say so in the DCF comment | **House rule.** Terminal value is commonly 60–80% of a DCF (McKinsey, *Valuation*). |
| Scenario weights | 30 / 50 / 20 | Explain any change | **House rule** (the owner's standard). |
| Margins of safety | 15% (buy) / 25% (strong buy) | Explain any change | **House rule**, after Graham's margin of safety. |

## Company ratios

| Ratio | Normal range | When outside | Source |
|---|---|---|---|
| Return on equity | 15% or more = passes the business test | Explain a one-year jump (one-offs, rupee gains) | The site's business test; Buffett's long-held ROE benchmark. |
| Justified P/E | payout × (1 + g) ÷ (r − g), with payout = 1 − g ÷ ROE | A chosen P/E above it needs a reason | CFA Institute, *Equity Asset Valuation* (justified P/E from the dividend model). |
| Justified P/B | (ROE − g) ÷ (r − g) | Same | CFA Institute, *Equity Asset Valuation*. |
| Residual income | (ROE − r) × opening book value | ROE should fade towards r over 5–10 years | CFA Institute, *Equity Asset Valuation* (residual income model, persistence). |
| Net debt / equity | no more than 1 = passes the business test | — | The site's business test. |
| Net debt / EBITDA | under 3× | Explain | Common lending covenant level; the site's debt test note. |
| Dividend cover (cash after maintenance ÷ dividends) | 1× or more | Below 1×: flag the dividend as at risk | CLAUDE.md, "P/E and dividends". |
| Maintenance capex ÷ depreciation | about 0.8 – 1.3 | Explain; depreciation includes impairment and licence amortisation for telecoms | Greenwald and others, *Value Investing* (maintenance capex method); **house range**. |
| Base-case EPS vs run-rate | not more than 10% below | Give a specific reason | **House rule**. |
| Cost of debt | within −4 / +8 points of the bond yield | Recheck interest and debt | **House rule** (the calculator warns). |
