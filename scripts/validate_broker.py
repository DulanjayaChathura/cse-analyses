#!/usr/bin/env python3
"""Check a broker summary (broker/<date>.json, docs/broker-format.md).

From schemaVersion 2, every summary must say what it read: a `coverage` entry for every
post it summarises, listing each section, table and chart in it, each marked `included`,
`approx` (read from a chart) or `left-out` with a reason. A summary that fails isn't
published (build_site.py skips it, announce.py doesn't post it).

    python scripts/validate_broker.py broker/2026-11-19.json [more files]
"""
import json
import sys
from pathlib import Path

STATUSES = ("included", "approx", "left-out")


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
        for k in ("target", "price"):
            if r.get(k) is not None and not is_num(r[k]):
                p.append(f"research on {r['company']}: {k} must be a number or null")
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
