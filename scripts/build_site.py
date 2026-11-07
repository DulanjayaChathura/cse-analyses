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

SITE = ROOT / "_site"
STATIC = ["index.html", "company.html", "assets"]


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


def summarize(data, warnings, bad, previous, companies):
    t = data["ticker"]
    company = data.get("company") if isinstance(data.get("company"), dict) else {}
    fetched = companies.get(t, {})
    ok = lambda k: k in data and k not in bad
    return {
        "ticker": t,
        "name": fetched.get("name") or company.get("name") or t,
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

    if PROBLEMS.exists():
        lines = [l for l in PROBLEMS.read_text(encoding="utf-8").splitlines() if l.strip()]
        if lines:
            problems = True
            report.append("### ⚠️ CSE data feed")
            report += [f"- {l}" for l in lines]

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
