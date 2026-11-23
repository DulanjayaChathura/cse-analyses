#!/usr/bin/env python3
"""List the numbered exhibits in a research report PDF, with the page each is on.

    python scripts/exhibits.py reports/…/report.pdf

Prints one line per page ("p. 8: 4a 4b") and then the JSON list to paste into the
research entry's `exhibits`. Uses pdftotext (poppler)."""
import json
import re
import subprocess
import sys


def exhibits(path):
    pages = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, check=True).stdout.split("\f")
    found = []
    for n, text in enumerate(pages, 1):
        labels = []
        for m in re.finditer(r"Exhibit\s+(\d+[a-z]?)\s*:", text):
            if m.group(1) not in labels and m.group(1) not in [x for _, x in found]:
                labels.append(m.group(1))
        found += [(n, x) for x in labels]
    return found


def main(path):
    found = exhibits(path)
    for page in sorted({p for p, _ in found}):
        print(f"p. {page}: {' '.join(x for p, x in found if p == page)}")
    print(json.dumps([x for _, x in found]))


if __name__ == "__main__":
    main(sys.argv[1])
