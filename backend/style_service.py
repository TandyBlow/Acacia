"""
Style service: computes visual style based on domain tag distribution.
"""
from os import getenv

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

supabase: Client = create_client(
    getenv("SUPABASE_URL") or "https://placeholder.supabase.co",
    getenv("SUPABASE_SERVICE_KEY") or "placeholder-key"
)

STYLE_RULES = [
    ('日本文化', 0.30, 'sakura'),
    ('编程技术', 0.40, 'cyberpunk'),
    ('文学艺术', 0.30, 'ink'),
]


def compute_style(user_id: str) -> dict:
    resp = supabase.table('nodes') \
        .select('domain_tag') \
        .eq('owner_id', user_id) \
        .eq('is_deleted', False) \
        .execute()

    nodes = resp.data
    if not nodes:
        return {"style": "default", "distribution": {}}

    total = len(nodes)
    counts: dict[str, int] = {}
    for node in nodes:
        tag = node.get('domain_tag') or '其他'
        counts[tag] = counts.get(tag, 0) + 1

    distribution = {tag: round(cnt / total, 4) for tag, cnt in counts.items()}

    for domain, threshold, style in STYLE_RULES:
        if distribution.get(domain, 0) > threshold:
            return {"style": style, "distribution": distribution}

    return {"style": "default", "distribution": distribution}
