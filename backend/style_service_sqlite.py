"""
Style service using SQLite + AI generation.
"""
import json
import logging
import time
from database import get_db_ctx

logger = logging.getLogger(__name__)
from style_generator import (
    generate_style, DEFAULT_PARAMS,
    build_profile_text, _cache_key,
    hydrate_user_state, cache_style,
)


def _fix_bg_url(url):
    """Rewrite old /backgrounds/ai/ URLs to /api/backgrounds/ai/ so they go through backend."""
    if url and isinstance(url, str) and url.startswith("/backgrounds/ai/") and "/api/" not in url:
        return "/api" + url
    return url


def _row_to_style_dict(row) -> dict:
    """Convert a user_styles DB row into the style result dict format."""
    try:
        params = json.loads(row["params_json"]) if row["params_json"] else DEFAULT_PARAMS
    except (json.JSONDecodeError, KeyError):
        params = DEFAULT_PARAMS
    try:
        distribution = json.loads(row["distribution_json"]) if row["distribution_json"] else {}
    except (json.JSONDecodeError, KeyError):
        distribution = {}
    return {
        "style": row["style_name"] or "default",
        "styleDescription": row["style_description"] or "",
        "params": params,
        "backgroundPrompt": row["background_prompt"] or "",
        "backgroundUrl": _fix_bg_url(row["background_url"]),
        "distribution": distribution,
        "_cached_at": 0,  # force TTL miss so _should_regenerate() runs Jaccard check
    }


def _maybe_fix_persisted_url(owner_id: str, bg_url):
    """If the DB has an old-format URL, fix it and persist."""
    if bg_url and isinstance(bg_url, str) and "/api/" not in bg_url and bg_url.startswith("/backgrounds/"):
        fixed = _fix_bg_url(bg_url)
        try:
            with get_db_ctx() as conn:
                conn.execute("UPDATE user_styles SET background_url = ? WHERE owner_id = ?", (fixed, owner_id))
        except Exception as e:
            logger.warning("Failed to fix background URL for %s: %s", owner_id, e)
        return fixed
    return bg_url


def _persist_style(conn, owner_id: str, profile_hash: str, profile_text: str, result: dict):
    """UPSERT style data into user_styles table."""
    params_json = json.dumps(result.get("params", {}), ensure_ascii=False)
    dist_json = json.dumps(result.get("distribution", {}), ensure_ascii=False)

    conn.execute("""
        INSERT INTO user_styles (
            owner_id, profile_hash, profile_text, style_name,
            style_description, background_prompt, background_url,
            params_json, distribution_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(owner_id) DO UPDATE SET
            profile_hash = excluded.profile_hash,
            profile_text = excluded.profile_text,
            style_name = excluded.style_name,
            style_description = excluded.style_description,
            background_prompt = excluded.background_prompt,
            background_url = excluded.background_url,
            params_json = excluded.params_json,
            distribution_json = excluded.distribution_json,
            updated_at = datetime('now')
    """, (
        owner_id, profile_hash, profile_text,
        result.get("style", "default"),
        result.get("styleDescription", ""),
        result.get("backgroundPrompt", ""),
        result.get("backgroundUrl"),
        params_json,
        dist_json,
    ))


def compute_style_sqlite(owner_id: str, force: bool = False) -> dict:
    """Compute a unique visual style for a user's knowledge tree.

    Uses AI (DeepSeek) to analyze knowledge content and generate
    personalized TreeStyleParams. Persists results to SQLite so
    styles survive server restarts.
    """
    with get_db_ctx() as conn:
        nodes = conn.execute(
            "SELECT id, name, content, domain_tag FROM nodes "
            "WHERE owner_id = ? AND is_deleted = 0",
            (owner_id,),
        ).fetchall()

    if not nodes:
        return {
            "style": "default",
            "params": DEFAULT_PARAMS,
            "backgroundPrompt": "",
            "distribution": {},
        }

    node_dicts = [{"name": n["name"], "content": n["content"], "domain_tag": n["domain_tag"]} for n in nodes]
    profile_text = build_profile_text(node_dicts)
    profile_hash = _cache_key(profile_text)

    # ── Check persisted style in DB ──
    if not force:
        with get_db_ctx() as conn:
            row = conn.execute(
                "SELECT * FROM user_styles WHERE owner_id = ?",
                (owner_id,),
            ).fetchone()

        if row and row["profile_hash"] == profile_hash:
            # Fix old-format URL in DB before returning
            _maybe_fix_persisted_url(owner_id, row["background_url"])
            result = _row_to_style_dict(row)
            debug = f"DB hit: style={result.get('style')}, bgUrl={result.get('backgroundUrl')}, bgPrompt={'SET' if result.get('backgroundPrompt') else 'EMPTY'}"
            print(f"[style] {debug}")
            # If background generation failed previously (e.g. missing API key),
            # retry it now.
            if result.get("backgroundUrl") is None:
                prompt = result.get("backgroundPrompt") or None
                if prompt:
                    from style_generator import _generate_background_image, _bg_image_cache
                    debug += " | Action: retry bg gen"
                    print(f"[style] Retrying background image for persisted style of {owner_id}")
                    retry_url, retry_err = _generate_background_image(prompt, owner_id, force=False)
                    if retry_url:
                        debug += " -> OK"
                        print(f"[style] Background retry succeeded: {retry_url}")
                        result["backgroundUrl"] = retry_url
                        _bg_image_cache[profile_hash] = retry_url
                        try:
                            with get_db_ctx() as conn2:
                                conn2.execute(
                                    "UPDATE user_styles SET background_url = ?, updated_at = datetime('now') WHERE owner_id = ?",
                                    (retry_url, owner_id),
                                )
                        except Exception as e:
                            print(f"[style] Failed to update background_url in DB for {owner_id}: {e}")
                    else:
                        debug += f" -> FAIL: {retry_err}"
                        print(f"[style] Background retry failed: {retry_err}")
                else:
                    debug += " | Action: full regenerate (no prompt)"
                    print(f"[style] No backgroundPrompt in DB for {owner_id}, triggering full regeneration")
                    result = generate_style(owner_id, node_dicts, force=True)
                    if result.get("generating"):
                        debug += " -> generating..."
                    else:
                        debug += f" -> bgUrl={result.get('backgroundUrl')}"
                    if not result.get("generating"):
                        try:
                            with get_db_ctx() as conn2:
                                _persist_style(conn2, owner_id, profile_hash, profile_text, result)
                        except Exception as e:
                            print(f"[style] Failed to persist regenerated style for {owner_id}: {e}")
            result["_debug"] = debug
            cache_style(profile_hash, result)
            hydrate_user_state(owner_id, row["profile_text"], 0)
            return result

        if row and row["profile_hash"] != profile_hash:
            result = _row_to_style_dict(row)
            result["_debug"] = f"DB hit but profile changed: oldHash={row['profile_hash'][:8]}... newHash={profile_hash[:8]}..., oldBgUrl={result.get('backgroundUrl')}"
            hydrate_user_state(owner_id, row["profile_text"], 0)
            cache_style(profile_hash, result)

    # ── Generate (or regenerate) ──
    result = generate_style(owner_id, node_dicts, force=force)

    # ── Persist the result ──
    if not result.get("generating"):
        try:
            with get_db_ctx() as conn:
                _persist_style(conn, owner_id, profile_hash, profile_text, result)
        except Exception as e:
            print(f"[style] Failed to persist style for {owner_id}: {e}")

    return result
