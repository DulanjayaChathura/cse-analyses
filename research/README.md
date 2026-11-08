# Research folder

One folder per company, named with its main CSE share code:

```
research/
  DIAL.N0000/
    reports/       ← you upload annual and interim report PDFs here
    record.json    ← the research record: everything saved from past reports and analyses
    history/       ← every past analysis, archived before it's replaced
```

## Adding a new report

1. On GitHub, open `research/<CODE>/reports/` (e.g. `research/DIAL.N0000/reports/`).
2. Click **Add file → Upload files**, drag in the PDF, and click **Commit changes**.
   - Name it so the period is clear, e.g. `2026-Q3-interim.pdf` or `2025-annual-report.pdf`.
   - GitHub's website accepts files up to 25 MB. For a bigger annual report, upload a compressed copy.
3. Tell Claude "I uploaded the Q3 report for DIAL" (in a chat with this repository connected).

Claude then:
- reads the research record and only the new report;
- updates the analysis and the record;
- archives the old analysis;
- opens a pull request for you to review.

## A new company

Create the folder by uploading the first PDF to `research/<CODE>/reports/`. Type the path in GitHub's upload page, and the folders are created for you. Then ask Claude for a first full analysis.

## Good to know

This repository is public, so anyone can download these PDFs. They are public company filings.
