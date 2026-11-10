"""Check every analysis file and build the website into _site/.

- A rejected file is replaced by its most recent valid version from git history,
  so the live site never breaks.
- Everything that needs your attention is written to the job summary, and
  `problems=true` is set so the workflow can email you.
"""
import os
import shutil
import subprocess
import sys

from common import DATA, GENERATED, PROBLEMS, ROOT, read_json, write_json
from validate import validate_text
import alerts
import cse

SITE = ROOT / "_site"
STATIC = ["index.html", "company.html", "broker.html", "assets"]


def git_versions(path):
    """Yield (commit, text) for older versions of a file, newest first."""
    rel = path.relative_to(ROOT).as_posix()
    try:
        commits = subprocess.run(["git", "log", "--format=%H", "--", rel], cwd=ROOT,
                                 capture_output=True, text=True, check=True).stdout.split()
    except (OSError, subprocess.CalledProcessError):
        return
    for c in commits:
        r = subprocess.run(["git", "show", f"{c}:{rel}"], cwd=ROOT, capture_output=True, text=True)
        if r.returncode == 0:
            yield c, r.stdout


def check_record(rec, ticker):
    """Light checks on a research record; returns a list of warnings."""
    w = []
    if not isinstance(rec, dict):
        return ["record.json must contain a JSON object"]
    if rec.get("ticker") != ticker:
        w.append(f'ticker in record.json is {rec.get("ticker")!r}, expected "{ticker}"')
    for key in ("reportsRead", "periods", "valuationInputs", "openQuestions", "changeLog"):
        if not isinstance(rec.get(key), list):
            w.append(f"'{key}' should be a list")
    seen = set()
    for per in rec.get("periods") or []:
        name = per.get("period") if isinstance(per, dict) else None
        if name in seen:
            w.append(f"period '{name}' appears twice")
        seen.add(name)
    for e in rec.get("changeLog") or []:
        if not isinstance(e, dict) or not isinstance(e.get("date"), str):
            w.append("every changeLog entry needs a date")
            break
    return w


def display_name(fetched, company, ticker):
    """The CSE's official name, written the way the analysis file writes it when they match
    (e.g. CSE "C I C HOLDINGS PLC" + file "CIC Holdings PLC" -> "CIC Holdings PLC")."""
    key = lambda x: "".join(ch for ch in (x or "").lower() if ch.isalnum())
    official = fetched.get("cseName") or fetched.get("name")
    mine = company.get("name")
    if official and mine and key(official) == key(mine):
        return mine
    return (cse.nice_name(official) if official else None) or mine or ticker


def summarize(data, warnings, bad, previous, companies):
    t = data["ticker"]
    company = data.get("company") if isinstance(data.get("company"), dict) else {}
    fetched = companies.get(t, {})
    ok = lambda k: k in data and k not in bad
    return {
        "ticker": t,
        "name": display_name(fetched, company, t),
        "logo": fetched.get("logo"),
        "sector": company.get("sector"),
        "fiscalYearEnd": company.get("fiscalYearEnd") if ok("company") else None,
        "shareClasses": data["shareClasses"] if ok("shareClasses") else [{"symbol": t, "label": "Voting"}],
        "analysisDate": data["analysisDate"],
        "price": data["price"] if ok("price") else None,
        "valuation": data["valuation"] if ok("valuation") else None,
        "verdict": data["summary"].get("verdict") if ok("summary") else None,
        "headline": data["summary"].get("headline") if ok("summary") else None,
        "resultsCovered": data["resultsCovered"] if ok("resultsCovered") else None,
        # Business-test result; the page turns it into a category using the latest price.
        "quality": {k: data["quality"].get(k) for k in ("rating", "passed", "outOf", "reason")} if ok("quality") else None,
        # Latest dividend per share for the card.
        "dividend": data["dividend"] if ok("dividend") else None,
        "badSections": bad,
        "warningCount": len(warnings),
        "usingPreviousVersion": previous,
    }


def main():
    report, problems = [], False
    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / "data" / "tickers").mkdir(parents=True)

    companies = read_json(GENERATED / "companies.json", {})
    manifest = []
    for path in sorted(DATA.glob("*.json")):
        data, errors, warnings, bad = validate_text(path.read_text(encoding="utf-8"), path.name)
        previous = None
        if errors:
            problems = True
            report.append(f"### ❌ {path.name} was rejected")
            report += [f"- {e}" for e in errors]
            for commit, text in git_versions(path):
                d, e2, w2, b2 = validate_text(text, path.name)
                if not e2:
                    data, warnings, bad, previous = d, w2, b2, commit[:7]
                    break
            report.append(f"- The site keeps showing the previous valid version ({previous})." if previous
                          else "- No earlier valid version exists, so this company is not shown yet.")
            if not data:
                continue
        elif warnings:
            problems = True
            report.append(f"### ⚠️ {path.name} was accepted with warnings")
            report += [f"- {w}" for w in warnings]
        data["_build"] = {"warnings": warnings, "badSections": bad, "previousVersion": previous}
        write_json(SITE / "data" / "tickers" / f"{data['ticker']}.json", data)
        manifest.append(summarize(data, warnings, bad, previous, companies))

    # Research records (research/<CODE>/record.json) for the "What changed" section.
    (SITE / "data" / "research").mkdir(parents=True, exist_ok=True)
    for entry in manifest:
        t = entry["ticker"]
        path = ROOT / "research" / t / "record.json"
        if not path.exists():
            entry["hasResearch"] = False
            continue
        rec = read_json(path, None)
        warns = check_record(rec, t) if rec is not None else ["record.json is not valid JSON"]
        if warns:
            problems = True
            report.append(f"### ⚠️ research/{t}/record.json")
            report += [f"- {x}" for x in warns]
        if isinstance(rec, dict):
            write_json(SITE / "data" / "research" / f"{t}.json", rec)
            log = [e for e in rec.get("changeLog") or [] if isinstance(e, dict) and e.get("date")]
            if log:
                last = log[-1]
                prev = log[-2] if len(log) > 1 else None
                entry["latestResearch"] = {
                    "date": last["date"], "kind": "updated" if prev else "new",
                    "basedOn": last.get("basedOn"), "summary": last.get("summary"),
                    "fairValue": last.get("fairValue"), "previousFairValue": prev.get("fairValue") if prev else None,
                }
        entry["hasResearch"] = isinstance(rec, dict)

    if PROBLEMS.exists():
        lines = [l for l in PROBLEMS.read_text(encoding="utf-8").splitlines() if l.strip()]
        if lines:
            problems = True
            report.append("### ⚠️ CSE data feed")
            report += [f"- {l}" for l in lines]

    # Price targets for the website, with the date each one fired (from the Actions cache).
    targets, alert_problems = alerts.load_targets()
    if alert_problems:
        problems = True
        report.append("### ⚠️ alerts.json")
        report += [f"- {p}" for p in alert_problems]
    fired = alerts.load_state()["fired"]
    for t in targets:
        t["fired"] = fired.get(t["key"])
    write_json(SITE / "data" / "alerts.json", {"targets": targets})

    # Broker summaries (broker/<date>.json) for the "Broker updates" page.
    # Each day is copied as-is; data/broker/index.json lists the days, newest first.
    days = []
    (SITE / "data" / "broker").mkdir(parents=True, exist_ok=True)
    for path in sorted((ROOT / "broker").glob("*.json"), reverse=True):
        day = read_json(path, None)
        if not isinstance(day, dict) or not day.get("date"):
            problems = True
            report.append(f"### ⚠️ broker/{path.name} is not a valid broker summary and was skipped")
            continue
        write_json(SITE / "data" / "broker" / path.name, day)
        days.append({"date": day["date"], "file": path.name, "source": day.get("source")})
    write_json(SITE / "data" / "broker" / "index.json", {"days": days})

    write_json(SITE / "data" / "index.json", {"companies": manifest})
    write_json(SITE / "data" / "prices.json", read_json(GENERATED / "prices.json", {}))
    if (GENERATED / "logos").exists():
        shutil.copytree(GENERATED / "logos", SITE / "generated" / "logos")
    for item in STATIC:
        src = ROOT / item
        (shutil.copytree if src.is_dir() else shutil.copy2)(src, SITE / item)

    text = "\n".join(report) if report else "All analysis files passed the checks."
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("## Data check\n\n" + text + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"problems={'true' if problems else 'false'}\n")
    print(f"Built {len(manifest)} companies into {SITE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
