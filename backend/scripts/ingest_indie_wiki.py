"""
Ingest Indie Wiki Buddy data into the wiki_registry.json.

Fetches the IWB sites JSON from GitHub, filters to MediaWiki entries,
and merges them into the wiki registry. Existing non-IWB entries are
preserved; IWB entries are replaced with fresh data on each run.

Usage:
    python scripts/ingest_indie_wiki.py              # update from GitHub
    python scripts/ingest_indie_wiki.py --dry-run    # preview without writing
    python scripts/ingest_indie_wiki.py --file path/to/sitesEN.json  # local file
"""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import quote

import httpx

REGISTRY_PATH = Path(__file__).parent.parent / "wiki_registry.json"
IWB_RAW_URL = "https://raw.githubusercontent.com/KevinPayravi/indie-wiki-buddy/main/data/sitesEN.json"
USER_AGENT = "Acacia/1.0 (knowledge-app; https://github.com/acacia)"


def fetch_iwb_json(url: str) -> list[dict]:
    """Fetch Indie Wiki Buddy JSON from a URL or local file."""
    if url.startswith("http://") or url.startswith("https://"):
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
            return resp.json()
    else:
        with open(url, "r", encoding="utf-8") as f:
            return json.load(f)


def iwb_to_registry(entry: dict) -> dict:
    """Convert an IWB entry to a wiki_registry source dict."""
    raw_name = entry.get("destination", "")
    base_url = entry.get("destination_base_url", "")
    safe_id = (
        raw_name.lower()
        .replace(" ", "_")
        .replace("'", "")
        .replace('"', "")
        .replace("(", "")
        .replace(")", "")
    )
    return {
        "name": raw_name,
        "base_url": base_url,
        "api_path": "/api.php",
        "rest_path": None,
        "platform": entry.get("destination_platform", "mediawiki"),
        "has_rest_api": False,
        "default_lang": "en",
        "fallback_langs": [],
        "rate_limit": 0.0,
        "user_agent": None,
        "tags": [],
        "origin": "indie_wiki_buddy",
        "priority": 30,
        "iwb_id": entry.get("id", ""),
        "search_path": entry.get("destination_search_path", "/index.php"),
        "content_path": entry.get("destination_content_path", "/wiki/"),
    }


def ingest(dry_run: bool = False, source_url: str = IWB_RAW_URL) -> dict:
    """Run the ingestion and return stats."""
    print(f"Fetching IWB data from: {source_url}")
    iwb_entries = fetch_iwb_json(source_url)
    print(f"  Total IWB entries: {len(iwb_entries)}")

    # Filter to MediaWiki only
    mediawiki_entries = [
        e for e in iwb_entries
        if e.get("destination_platform") == "mediawiki"
    ]
    print(f"  MediaWiki entries: {len(mediawiki_entries)}")
    print(f"  Skipped (non-MediaWiki): {len(iwb_entries) - len(mediawiki_entries)}")

    # Load current registry
    with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
        registry = json.load(f)

    current_sources = registry.get("sources", {})

    # Remove old IWB entries
    preserved = {
        src_id: cfg
        for src_id, cfg in current_sources.items()
        if cfg.get("origin") != "indie_wiki_buddy"
    }
    removed_count = len(current_sources) - len(preserved)
    print(f"  Removed old IWB entries: {removed_count}")

    # Convert and add new IWB entries (skip duplicates by base_url)
    added = 0
    seen_urls = {cfg.get("base_url", "") for cfg in preserved.values()}
    for entry in mediawiki_entries:
        cfg = iwb_to_registry(entry)
        base = cfg["base_url"]
        if base in seen_urls:
            continue
        seen_urls.add(base)
        src_id = cfg["name"].lower().replace(" ", "_").replace("'", "").replace('"', "")
        preserved[src_id] = cfg
        added += 1

    print(f"  Added new IWB entries: {added}")
    print(f"  Duplicates skipped: {len(mediawiki_entries) - added}")

    registry["sources"] = preserved

    if not dry_run:
        # Pretty-print with sorted keys for readability
        with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
            json.dump(registry, f, ensure_ascii=False, indent=2)
        print(f"  Wrote {REGISTRY_PATH}")
    else:
        print("  [DRY RUN] No changes written")

    return {
        "total_iwb": len(iwb_entries),
        "mediawiki": len(mediawiki_entries),
        "removed_old": removed_count,
        "added": added,
        "preserved_builtin": len(preserved) - added,
        "total_sources": len(preserved),
    }


def main():
    parser = argparse.ArgumentParser(description="Ingest Indie Wiki Buddy data")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview changes without writing to registry"
    )
    parser.add_argument(
        "--file", type=str, default=None,
        help="Path to a local IWB sites JSON file (default: fetch from GitHub)"
    )
    args = parser.parse_args()

    source = args.file or IWB_RAW_URL
    stats = ingest(dry_run=args.dry_run, source_url=source)

    print()
    print("=== Summary ===")
    print(f"  Total sources in registry: {stats['total_sources']}")
    print(f"  Builtin/manual entries: {stats['preserved_builtin']}")
    print(f"  IWB entries: {stats['added']}")


if __name__ == "__main__":
    main()
