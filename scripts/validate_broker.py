#!/usr/bin/env python3
"""Check a broker summary (broker/<date>.json, docs/broker-format.md).

From schemaVersion 2, every summary must say what it read: a `coverage` entry for every
post it summarises, listing each section, table and chart in it, each marked `included`,
`approx` (read from a chart) or `left-out` with a reason. A summary that fails isn't
published (build_site.py skips it, announce.py doesn't post it).

    python scripts/validate_broker.py broker/2026-11-19.json [more files]
"""
import json
import re
import sys
from pathlib import Path

STATUSES = ("included", "approx", "left-out")
PLOTS = ("hbar", "vbar", "line", "waterfall", "heatmap", "range", "riskgrid", "scatter", "radar", "none")


def labels_in(text):
    """Exhibit labels named in a title: 'Exhibit 4a', 'Exhibits 26a–f', 'Exhibits 31a–31b', 'Exhibits 7a, 7b'."""
    out = set()
    for m in re.finditer(r"Exhibits?\s+([0-9][0-9a-z,–\- ]*)", text):
        for part in re.split(r",\s*", m.group(1).strip()):
            r = re.match(r"^(\d+)([a-z]?)\s*[–-]\s*(?:\d+)?([a-z])$", part.strip())
            if r:
                out |= {r.group(1) + chr(c) for c in range(ord(r.group(2) or "a"), ord(r.group(3)) + 1)}
            elif re.match(r"^\d+[a-z]?$", part.strip()):
                out.add(part.strip())
    return out


def detail_problems(r):
    p, named = [], set()
    who = f"research on {r.get('company')}"
    for sec in r.get("details") or []:
        if not isinstance(sec, dict) or not isinstance(sec.get("title"), str):
            p.append(f"{who}: each details section needs a title")
            continue
        for b in sec.get("tables") or []:
            if not isinstance(b, dict) or not isinstance(b.get("title"), str):
                p.append(f"{who}, {sec['title']}: each block needs a title")
                continue
            named |= labels_in(b["title"])
            if "rows" in b:
                head = b.get("head") or []
                if any(len(row) != len(head) for row in b["rows"]):
                    p.append(f"{who}: '{b['title']}' has rows that don't match its {len(head)} columns")
                notes = b.get("rowNotes")
                if notes is not None and (len(notes) != len(b["rows"]) or any(len(n) != len(head) - 1 for n in notes)):
                    p.append(f"{who}: '{b['title']}' rowNotes need one note per row and value column")
                kind = (b.get("plot") or {}).get("kind", "none")
                if kind not in PLOTS:
                    p.append(f"{who}: '{b['title']}' has an unknown plot kind '{kind}'")
            elif "stats" in b:
                if not isinstance(b["stats"], list) or not all(isinstance(x, dict) and x.get("value") and x.get("label") for x in b["stats"]):
                    p.append(f"{who}: '{b['title']}' stats need a value and a label each")
            elif not b.get("points") and not b.get("text"):
                p.append(f"{who}: '{b['title']}' needs rows, points or text")
    if r.get("exhibits"):
        left = set()
        for c in r.get("_coverage") or []:
            for i in c.get("items") or []:
                if i.get("status") == "left-out":
                    left |= labels_in(i.get("item", ""))
        missing = [x for x in r["exhibits"] if x not in named and x not in left]
        if missing:
            p.append(f"{who}: exhibits neither summarised in details nor left out with a reason: {', '.join(missing)}")
    return p


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def problems(day):
    p = []
    if not isinstance(day, dict) or not isinstance(day.get("date"), str):
        return ["not a broker summary (no date)"]
    if (day.get("schemaVersion") or 1) < 2:
        return p   # older summaries predate the checklist
    ids = [i for i in day.get("messageIds") or []]
    cov = day.get("coverage")
    if not isinstance(cov, list) or not cov:
        return ["coverage is missing: list every post and what was read from it"]
    covered = set()
    for c in cov:
        if not isinstance(c, dict) or c.get("post") is None:
            p.append("each coverage entry needs `post` (the message id)")
            continue
        covered.add(c["post"])
        items = c.get("items")
        if not isinstance(items, list) or not items:
            p.append(f"post {c['post']}: coverage has no items")
            continue
        for i in items:
            if not isinstance(i, dict) or not isinstance(i.get("item"), str) or i.get("status") not in STATUSES:
                p.append(f"post {c['post']}: each item needs `item` and a `status` of {', '.join(STATUSES)}")
            elif i["status"] == "left-out" and not (i.get("reason") or "").strip():
                p.append(f"post {c['post']}: '{i['item']}' is left out without a reason")
    missing = [i for i in ids if i not in covered]
    if missing:
        p.append(f"posts with no coverage entry: {missing}")
    for r in day.get("research") or []:
        if not isinstance(r, dict) or not isinstance(r.get("company"), str):
            p.append("each research entry needs `company`")
            continue
        if not isinstance(r.get("keyPoints"), list) or not r["keyPoints"]:
            p.append(f"research on {r['company']}: keyPoints is empty")
        r["_coverage"] = [c for c in cov if c.get("post") == r.get("post")]
        p += detail_problems(r)
        r.pop("_coverage", None)
        for k in ("target", "price"):
            if r.get(k) is not None and not is_num(r[k]):
                p.append(f"research on {r['company']}: {k} must be a number or null")
    for h in day.get("highlights") or []:
        if not isinstance(h, str) and not (isinstance(h, dict) and isinstance(h.get("title"), str) and isinstance(h.get("text"), str)):
            p.append("each highlight needs `title` and `text` (or is a plain sentence)")
            break
    for f in ((day.get("market") or {}).get("foreignFlows") or []):
        if not isinstance(f, dict) or not isinstance(f.get("code"), str) or not is_num(f.get("mn")):
            p.append("market.foreignFlows entries need `code` and a number `mn`")
            break
    for o in ((day.get("market") or {}).get("other") or []):
        if not isinstance(o, dict) or not isinstance(o.get("label"), str) or o.get("value") is None:
            p.append("market.other entries need `label` and `value`")
            break
    return p


def main(paths):
    bad = 0
    for path in paths:
        day = json.loads(Path(path).read_text(encoding="utf-8"))
        probs = problems(day)
        if probs:
            bad += 1
            print(f"{path}: NOT PUBLISHABLE")
            for x in probs:
                print(f"  - {x}")
        else:
            print(f"{path}: OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
