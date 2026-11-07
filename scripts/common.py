"""Helpers shared by the build and fetch scripts."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GENERATED = ROOT / "generated"
PROBLEMS = ROOT / ".problems.txt"  # not committed; read by build_site.py


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def note_problem(msg):
    print("WARNING:", msg)
    with open(PROBLEMS, "a", encoding="utf-8") as f:
        f.write(msg + "\n")


def tickers_and_symbols():
    """Return {ticker: [symbols]} from every analysis file that can be read."""
    out = {}
    for p in sorted(DATA.glob("*.json")):
        d = read_json(p, None)
        if not isinstance(d, dict):
            continue
        t = d.get("ticker") or p.stem
        syms = [c.get("symbol") for c in d.get("shareClasses") or [] if isinstance(c, dict) and c.get("symbol")]
        out[t] = syms or [t]
    return out
