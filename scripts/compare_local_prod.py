"""Content-level comparison: local dev DB vs production snapshot.

Reproducible check for the rescue conclusion "the 2026-09-30 local dev
database shares no content with production". Compares every content-bearing
node pairwise (similarity ratio + longest common block) and searches every
production Notes/IDEA line fragment across the local database.

The script is version-controlled; its two input files are workspace-local
rescue artifacts (rescue/ is gitignored) and must be provided separately:
- rescue/ok/acacia.db                    — production snapshot (Actions artifact)
- rescue/hongxintt_local_snapshot.json   — local dev DB node export

Usage (from repo root):
    python scripts/compare_local_prod.py

Read-only: opens both inputs with mode=ro and writes nothing.
"""
import json
import sqlite3
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROD_SNAPSHOT = ROOT / "rescue" / "ok" / "acacia.db"
LOCAL_SNAPSHOT = ROOT / "rescue" / "hongxintt_local_snapshot.json"
PROD_OWNER = "0ca20783-f509-49b1-a946-224ffef48055"  # hongxintt


def load_prod() -> list[dict]:
    conn = sqlite3.connect(f"file:{PROD_SNAPSHOT}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, name, content FROM nodes WHERE owner_id=? AND is_deleted=0 AND length(content)>0",
        (PROD_OWNER,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def load_local() -> list[dict]:
    nodes = json.loads(LOCAL_SNAPSHOT.read_text(encoding="utf-8"))
    return [n for n in nodes if not n.get("is_deleted") and len(n.get("content") or "") > 50]


def main() -> None:
    prod = load_prod()
    local = load_local()
    print(f"prod content nodes: {len(prod)}, local content nodes: {len(local)}")

    hits = []
    for ln in local:
        lc = ln["content"]
        for pn in prod:
            pc = pn["content"]
            if SequenceMatcher(None, lc[:3000], pc[:3000]).quick_ratio() < 0.3:
                continue
            ratio = SequenceMatcher(None, lc, pc).ratio()
            m = SequenceMatcher(None, lc, pc).find_longest_match(0, len(lc), 0, len(pc))
            if ratio >= 0.5 or m.size >= 80:
                hits.append((ln["name"], pn["name"], round(ratio, 2), m.size))

    hits.sort(reverse=True)
    if hits:
        print("\nSIGNIFICANT OVERLAP (local node, prod node, ratio, longest common block):")
        for h in hits[:20]:
            print(" ", h)
    else:
        print("\nno significant content overlap between local dev DB and production")

    print("\nfragment search of production Notes/IDEA lines inside the local DB:")
    by_name = {p["name"]: p for p in prod if p["name"] in ("Notes", "IDEA")}
    for label in ("Notes", "IDEA"):
        node = by_name.get(label)
        if not node:
            print(f"  {label}: not in snapshot")
            continue
        fragments = [f.strip() for f in node["content"].split("\n") if len(f.strip()) >= 15]
        found = 0
        for frag in fragments:
            for ln in local:
                if frag in ln["content"]:
                    print(f'  {label} fragment "{frag[:40]}" found in local node "{ln["name"]}"')
                    found += 1
                    break
        if not found:
            print(f"  {label}: no fragment found in the local DB")


if __name__ == "__main__":
    main()
