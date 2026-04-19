"""
Style service using SQLite.
"""
from database import get_db_ctx
from style_service import STYLE_RULES


def compute_style_sqlite(owner_id: str) -> dict:
    with get_db_ctx() as conn:
        nodes = conn.execute(
            "SELECT domain_tag FROM nodes WHERE owner_id = ? AND is_deleted = 0",
            (owner_id,),
        ).fetchall()

    if not nodes:
        return {"style": "default", "distribution": {}}

    total = len(nodes)
    counts: dict[str, int] = {}
    for node in nodes:
        tag = node["domain_tag"] or "其他"
        counts[tag] = counts.get(tag, 0) + 1

    distribution = {tag: round(cnt / total, 4) for tag, cnt in counts.items()}

    for domain, threshold, style in STYLE_RULES:
        if distribution.get(domain, 0) > threshold:
            return {"style": style, "distribution": distribution}

    return {"style": "default", "distribution": distribution}
