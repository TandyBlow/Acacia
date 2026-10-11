"""Content-level comparison: local dev DB vs production snapshot.

Reproducible check for the rescue conclusion "the 2026-09-30 local dev
database shares no content with production". Compares every content-bearing
node pairwise (similarity ratio + longest common block) and searches every
production Notes/IDEA line fragment across the local database.

The pair prefilter is position-independent: two nodes are only skipped when
they share no 24-character window anywhere in either text. The previous
first-3000-characters quick_ratio gate skipped pairs whose shared content
sat later in either text (verified with a 249-character shared block placed
past the prefix), so a "no overlap" verdict from it is not trustworthy.
Pairs that share shingles but miss the significance bar are reported as
near-misses, ordered by longest common block, so the recovery-source
judgment can rest on the full picture rather than a binary hit/miss.

The script is version-controlled; its two input files are workspace-local
rescue artifacts (rescue/ is gitignored) and must be provided separately:
- rescue/ok/acacia.db                    — production snapshot (Actions artifact)
- rescue/hongxintt_local_snapshot.json   — local dev DB node export

Usage (from repo root):
    python scripts/compare_local_prod.py

Read-only: opens both inputs with mode=ro and writes nothing.
"""
import json
import re
import sqlite3
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROD_SNAPSHOT = ROOT / "rescue" / "ok" / "acacia.db"
LOCAL_SNAPSHOT = ROOT / "rescue" / "hongxintt_local_snapshot.json"
PROD_OWNER = "0ca20783-f509-49b1-a946-224ffef48055"  # hongxintt

SHINGLE_WIDTH = 24


def shingles(text: str) -> set[str]:
    """Every SHINGLE_WIDTH-character window of the whitespace-normalized
    text (step 1), so any shared block of that length anywhere in either
    side registers, while whitespace-only runs (indentation, blank lines)
    cannot fabricate an overlap."""
    normalized = re.sub(r"\s+", " ", text)
    if len(normalized) <= SHINGLE_WIDTH:
        return {normalized} if normalized.strip() else set()
    return {normalized[i:i + SHINGLE_WIDTH] for i in range(len(normalized) - SHINGLE_WIDTH + 1)}


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

    prod_sh = [shingles(p["content"]) for p in prod]
    local_sh = [shingles(n["content"]) for n in local]

    hits = []
    near_misses = []
    compared = 0
    skipped = 0
    for li, ln in enumerate(local):
        lc = ln["content"]
        for pi, pn in enumerate(prod):
            shared = local_sh[li] & prod_sh[pi]
            if not shared:
                skipped += 1
                continue
            compared += 1
            matcher = SequenceMatcher(None, lc, pn["content"], autojunk=False)
            ratio = matcher.ratio()
            m = matcher.find_longest_match(0, len(lc), 0, len(pn["content"]))
            record = (ln["name"], pn["name"], round(ratio, 2), m.size, len(shared))
            if ratio >= 0.5 or m.size >= 80:
                hits.append(record)
            else:
                near_misses.append(record)

    print(f"\npairs compared: {compared}, skipped by prefilter: {skipped}")
    hits.sort(reverse=True)
    if hits:
        print("\nSIGNIFICANT OVERLAP (local node, prod node, ratio, longest common block, shared windows):")
        for h in hits[:20]:
            print(" ", h)
    else:
        print("\nno significant content overlap between local dev DB and production")

    near_misses.sort(key=lambda r: r[3], reverse=True)
    if near_misses:
        print("\nNEAR MISS (shared windows but below the significance bar; local node, prod node, ratio, longest common block, shared windows):")
        for r in near_misses[:15]:
            print(" ", r)
    elif not hits:
        print("\nno near misses: no pair shares even a single 24-character window")

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
            exact = next((ln["name"] for ln in local if frag in ln["content"]), None)
            if exact:
                print(f'  {label} fragment "{frag[:40]}" found verbatim in local node "{exact}"')
                found += 1
                continue
            # Fallback for merged/reordered content: count shared windows
            # between the fragment and each local node.
            frag_sh = shingles(frag)
            partial = next(
                ((ln["name"], len(frag_sh & s)) for ln, s in zip(local, local_sh) if frag_sh & s),
                None,
            )
            if partial:
                print(f'  {label} fragment "{frag[:40]}" partial window match in local node "{partial[0]}" ({partial[1]} windows)')
                found += 1
        if not found:
            print(f"  {label}: no fragment found in the local DB (exact or window match)")


if __name__ == "__main__":
    main()
