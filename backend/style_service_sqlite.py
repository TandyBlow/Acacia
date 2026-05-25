"""
Style service using SQLite + AI generation.
"""
from database import get_db_ctx
from style_generator import generate_style, DEFAULT_PARAMS


def compute_style_sqlite(owner_id: str, force: bool = False) -> dict:
    """Compute a unique visual style for a user's knowledge tree.

    Uses AI (DeepSeek) to analyze knowledge content and generate
    personalized TreeStyleParams. Falls back to default params on failure.
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
    return generate_style(owner_id, node_dicts, force=force)
