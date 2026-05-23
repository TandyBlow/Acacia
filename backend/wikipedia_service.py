"""
Multi-source wiki knowledge service for Acacia.
Provides article search, summary fetching, concept verification, and
context formatting for AI prompt injection.

Supports Wikipedia, 萌娘百科, Yugipedia, and any MediaWiki-based wiki
configured in wiki_registry.json.

Uses Wikipedia REST API where available; falls back to MediaWiki Action API.
All calls are cached in-memory with a 1-hour TTL and fail gracefully.
"""
import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Dict, List
from urllib.parse import quote

import httpx


# ── Registry ───────────────────────────────────────────────────────────────

_REGISTRY_PATH = Path(__file__).parent / "wiki_registry.json"
_registry: dict | None = None
_registry_lock = threading.Lock()


def _load_registry() -> dict:
    """Load the wiki source registry lazily on first access."""
    global _registry
    if _registry is not None:
        return _registry
    with _registry_lock:
        if _registry is not None:
            return _registry
        with open(_REGISTRY_PATH, "r", encoding="utf-8") as f:
            _registry = json.load(f)
        return _registry


def _get_source(source_id: str | None = None) -> dict:
    """Resolve a source ID to its config dict.

    When source_id is None, returns the registry's default source.
    """
    registry = _load_registry()
    if source_id is None:
        source_id = registry.get("auto_select", {}).get("default_source", "wikipedia_zh")
    src = registry.get("sources", {}).get(source_id)
    if src is None:
        raise ValueError(f"Unknown wiki source: {source_id}")
    return src


def list_sources() -> list[dict]:
    """Return all registered wiki sources with their metadata."""
    registry = _load_registry()
    return [
        {"id": src_id, **cfg}
        for src_id, cfg in registry.get("sources", {}).items()
    ]


# ── Cache ────────────────────────────────────────────────────────────────

_wiki_cache: Dict[str, dict] = {}
_cache_ttl: float = 3600.0  # 1 hour


def _cache_key(op: str, title: str, lang: str, source: str) -> str:
    return hashlib.sha256(f"{op}|{source}|{lang}|{title}".encode("utf-8")).hexdigest()


def _cached_get(key: str) -> dict | None:
    entry = _wiki_cache.get(key)
    if entry and (time.time() - entry.get("_cached_at", 0)) < _cache_ttl:
        return entry
    return None


def _cache_put(key: str, data: dict) -> None:
    data["_cached_at"] = time.time()
    _wiki_cache[key] = data


# ── Rate limiter ──────────────────────────────────────────────────────────

_last_request: dict[str, float] = {}
_rate_lock = threading.Lock()


def _rate_limit(source_id: str, min_interval: float) -> None:
    """Enforce a minimum interval between requests to a source."""
    if min_interval <= 0:
        return
    with _rate_lock:
        last = _last_request.get(source_id, 0)
        elapsed = time.time() - last
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
        _last_request[source_id] = time.time()


# ── HTTP helpers ───────────────────────────────────────────────────────────

USER_AGENT = "Acacia/1.0 (knowledge-app; https://github.com/acacia)"


def _rest_get(path: str, source: str = "wikipedia_zh", lang: str | None = None,
              timeout: float = 10.0) -> dict | None:
    """GET a Wikipedia REST endpoint. Returns parsed JSON or None on failure."""
    src = _get_source(source)
    base = src["base_url"]
    if lang and src.get("has_rest_api"):
        parts = base.split(".", 1)
        if len(parts) == 2:
            base = f"{lang}.{parts[1]}"
    url = f"https://{base}{src['rest_path']}{path}"
    ua = src.get("user_agent") or USER_AGENT
    headers = {"User-Agent": ua, "Accept": "application/json"}
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, httpx.TimeoutException):
        return None


def _api_get(params: dict, source: str = "wikipedia_zh", lang: str | None = None,
             timeout: float = 10.0) -> dict | None:
    """GET a MediaWiki Action API endpoint. Returns parsed JSON or None on failure."""
    src = _get_source(source)
    base = src["base_url"]
    if lang and src.get("has_rest_api"):
        parts = base.split(".", 1)
        if len(parts) == 2:
            base = f"{lang}.{parts[1]}"
    url = f"https://{base}{src['api_path']}"
    ua = src.get("user_agent") or USER_AGENT
    headers = {"User-Agent": ua, "Accept": "application/json"}
    _rate_limit(source, src.get("rate_limit", 0))
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=headers, params=params)
            resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, httpx.TimeoutException):
        return None


# ── Public API ───────────────────────────────────────────────────────────


def search_wikipedia(query: str, lang: str = "zh", *, source: str | None = None) -> list[dict]:
    """Search a wiki for articles matching a query.

    Returns up to 5 results: [{"title": str, "description": str, "url": str}, ...]
    For Wikipedia sources, falls back to English if the primary language returns nothing.
    """
    if not query or not query.strip():
        return []

    src_id = source or "wikipedia_zh"
    src = _get_source(src_id)
    q = query.strip()
    key = _cache_key("search", q, lang, src_id)
    cached = _cached_get(key)
    if cached:
        return cached.get("results", [])

    fallback_langs = src.get("fallback_langs", [])
    for attempt_lang in (lang, *fallback_langs):
        data = _api_get({
            "action": "opensearch",
            "search": q,
            "limit": 5,
            "format": "json",
        }, source=src_id, lang=attempt_lang)
        if data and len(data) >= 4:
            titles = data[1]
            descriptions = data[2]
            urls = data[3]
            results = [
                {"title": t, "description": d, "url": u}
                for t, d, u in zip(titles, descriptions, urls)
            ]
            if results:
                _cache_put(key, {"results": results})
                return results

    _cache_put(key, {"results": []})
    return []


def get_article_summary(title: str, lang: str = "zh", *, source: str | None = None) -> dict | None:
    """Get a wiki article summary.

    Returns {"title", "extract", "description", "url", "thumbnail", "source_name", "source_id"} or None.
    The extract is a plain-text summary (usually 2-4 paragraphs).

    Uses REST API for Wikipedia sources; MediaWiki Action API for others.
    """
    if not title or not title.strip():
        return None

    src_id = source or "wikipedia_zh"
    src = _get_source(src_id)
    t = title.strip()
    key = _cache_key("summary", t, lang, src_id)
    cached = _cached_get(key)
    if cached is not None:
        if cached.get("_null"):
            return None
        return cached

    fallback_langs = src.get("fallback_langs", [])

    if src.get("has_rest_api"):
        # ── Wikipedia REST API path ─────────────────────────────────
        for attempt_lang in (lang, *fallback_langs):
            encoded = quote(t, safe="")
            data = _rest_get(f"/page/summary/{encoded}", source=src_id, lang=attempt_lang)
            if data and data.get("title") != "Not found.":
                result = {
                    "title": data.get("title", t),
                    "extract": data.get("extract", ""),
                    "description": data.get("description", ""),
                    "url": f"https://{attempt_lang}.wikipedia.org/wiki/{quote(t)}",
                    "thumbnail": data.get("thumbnail", {}).get("source", ""),
                    "lang": attempt_lang,
                    "source_name": src.get("name", "Wikipedia"),
                    "source_id": src_id,
                }
                _cache_put(key, result)
                return result
    else:
        # ── MediaWiki Action API path (non-Wikipedia wikis) ────────
        data = _api_get({
            "action": "query",
            "prop": "extracts|pageimages|info",
            "exintro": 1,
            "explaintext": 1,
            "piprop": "thumbnail",
            "pithumbsize": 300,
            "inprop": "url",
            "titles": t,
            "format": "json",
        }, source=src_id)
        if data and "query" in data:
            pages = data["query"].get("pages", {})
            for page_id, page in pages.items():
                if page_id == "-1":
                    continue  # page not found
                result = {
                    "title": page.get("title", t),
                    "extract": page.get("extract", ""),
                    "description": "",
                    "url": f"https://{src['base_url']}{src.get('destination_content_path', '/wiki/')}{quote(page.get('title', t))}",
                    "thumbnail": page.get("thumbnail", {}).get("source", ""),
                    "lang": src.get("default_lang", lang),
                    "source_name": src.get("name", "Wikipedia"),
                    "source_id": src_id,
                }
                _cache_put(key, result)
                return result

    # Cache the miss
    _cache_put(key, {"_null": True})
    return None


def verify_concept(name: str, lang: str = "zh", *, source: str | None = None) -> dict:
    """Check if a term has a wiki article.

    Returns {"verified": bool, "title": str, "summary": str, "description": str, "url": str}.
    Tries the primary language first, falls back to configured fallback languages.
    """
    summary = get_article_summary(name, lang, source=source)
    if summary:
        return {
            "verified": True,
            "title": summary["title"],
            "summary": summary["extract"],
            "description": summary.get("description", ""),
            "url": summary.get("url", ""),
        }
    return {
        "verified": False,
        "title": name,
        "summary": "",
        "description": "",
        "url": "",
    }


def get_related_topics(title: str, lang: str = "zh", *, source: str | None = None) -> list[dict]:
    """Get related articles for a topic.

    Returns up to 10 related articles: [{"title", "extract", "url"}, ...]
    Uses REST API for Wikipedia sources; MediaWiki Action API (generator=links) for others.
    """
    if not title or not title.strip():
        return []

    src_id = source or "wikipedia_zh"
    src = _get_source(src_id)
    t = title.strip()
    key = _cache_key("related", t, lang, src_id)
    cached = _cached_get(key)
    if cached is not None:
        if cached.get("_null"):
            return []
        return cached.get("results", [])

    fallback_langs = src.get("fallback_langs", [])

    if src.get("has_rest_api"):
        # ── Wikipedia REST API path ─────────────────────────────────
        for attempt_lang in (lang, *fallback_langs):
            encoded = quote(t, safe="")
            data = _rest_get(f"/page/related/{encoded}", source=src_id, lang=attempt_lang)
            if data and "pages" in data:
                results = []
                for page in data["pages"][:10]:
                    results.append({
                        "title": page.get("title", ""),
                        "extract": page.get("extract", ""),
                        "url": f"https://{attempt_lang}.wikipedia.org/wiki/{quote(page.get('title', ''))}",
                    })
                if results:
                    _cache_put(key, {"results": results})
                    return results
    else:
        # ── MediaWiki Action API path (use page links as proxy) ─────
        data = _api_get({
            "action": "query",
            "generator": "links",
            "gpllimit": 10,
            "prop": "extracts",
            "exintro": 1,
            "explaintext": 1,
            "titles": t,
            "format": "json",
        }, source=src_id)
        if data and "query" in data:
            pages = data["query"].get("pages", {})
            results = []
            for page_id, page in pages.items():
                page_title = page.get("title", "")
                results.append({
                    "title": page_title,
                    "extract": page.get("extract", ""),
                    "url": f"https://{src['base_url']}{src.get('destination_content_path', '/wiki/')}{quote(page_title)}",
                })
            if results:
                _cache_put(key, {"results": results[:10]})
                return results[:10]

    _cache_put(key, {"_null": True, "results": []})
    return []


def format_wiki_context(summary: dict | None, related: list[dict] | None = None,
                        *, source_label: str = "Wikipedia") -> str:
    """Format wiki data as a structured context block for AI prompt injection.

    Args:
        summary: Result from get_article_summary().
        related: Optional result from get_related_topics().
        source_label: Display name for the wiki source in the header.

    Returns:
        Formatted string ready for injection, or "" if no data.
    """
    if not summary:
        return ""

    lines = [f"【{source_label} 背景知识】"]

    title = summary.get("title", "")
    description = summary.get("description", "")
    extract = summary.get("extract", "")

    if title:
        lines.append(f"主题：{title}")
    if description:
        lines.append(f"简介：{description}")

    if extract:
        # Truncate extract to ~500 chars to keep prompts manageable
        short = extract[:500].strip()
        if len(extract) > 500:
            short += "…"
        lines.append(f"摘要：{short}")

    if related:
        related_names = [r["title"] for r in related[:8] if r.get("title")]
        if related_names:
            lines.append(f"相关主题：{'、'.join(related_names)}")

    return "\n".join(lines)
