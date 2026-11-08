# Research folder

One folder per company in this repository, named with its main CSE share code:

```
research/
  DIAL.N0000/
    record.json    ← the research record: everything saved from past reports and analyses
    history/       ← every past analysis, archived before it's replaced
```

## Where the report PDFs live

The PDFs stay **on the owner's laptop**, not in this public repository:

```
OneDrive\Documents\cse-research\
  dialog\          ← one folder per company (any name; saved as localFolder in record.json)
  sampath bank\
  ...
```

To update a company, add the new PDF to its laptop folder and tell Claude (with the Claude desktop app open). Claude reads the record here and only the new PDF, updates the analysis and the record, archives the old analysis, and pushes straight to `main`, which republishes the site.
