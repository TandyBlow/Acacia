"""
Knowledge gap detection for chat sessions.
Checks the user's knowledge tree to determine if they have
prerequisites for the current topic. Runs at session start
and every N turns (N=3) to avoid excessive DB queries.
"""
from database import get_db_ctx


def detect_gaps(owner_id: str, current_node_id: str) -> dict:
    """Analyze the user's knowledge tree for gaps related to the current node.

    Returns:
        {"total_nodes": int, "related_domain_nodes": int, "same_domain_nodes": int,
         "has_prerequisites": bool, "domain_tag": str, "severity": str}
    """
    with get_db_ctx() as conn:
        # Get current node's domain_tag
        cur = conn.execute(
            "SELECT domain_tag, parent_id FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
            (current_node_id, owner_id),
        ).fetchone()

    if not cur:
        return {
            "total_nodes": 0, "related_domain_nodes": 0, "same_domain_nodes": 0,
            "has_prerequisites": False, "domain_tag": "", "severity": "none",
        }

    domain_tag = cur["domain_tag"] or ""
    parent_id = cur["parent_id"]

    # Count all user nodes
    with get_db_ctx() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND is_deleted = 0",
            (owner_id,),
        ).fetchone()[0]

        # Count same-domain nodes
        if domain_tag:
            same_domain = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND domain_tag = ? AND is_deleted = 0 AND id != ?",
                (owner_id, domain_tag, current_node_id),
            ).fetchone()[0]
        else:
            same_domain = 0

        # Count siblings (same parent)
        if parent_id:
            siblings = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0 AND id != ?",
                (owner_id, parent_id, current_node_id),
            ).fetchone()[0]
        else:
            siblings = 0

        # Related = same domain + siblings (deduplication not needed since siblings
        # might be in different domains, and same-domain nodes might be under different parents)
        related = same_domain + siblings

    # Determine severity
    if total <= 2:
        severity = "critical"  # brand new user, almost no nodes at all
    elif related < 3:
        severity = "critical"  # nothing related in the tree
    elif related < 8:
        severity = "moderate"  # some foundation
    else:
        severity = "none"  # well-established

    return {
        "total_nodes": total,
        "related_domain_nodes": related,
        "same_domain_nodes": same_domain,
        "has_prerequisites": related >= 3,
        "domain_tag": domain_tag,
        "severity": severity,
    }


def format_gap_warning(gap_result: dict) -> str:
    """Convert a gap detection result into a single-line instruction for handler prompts."""
    severity = gap_result.get("severity", "none")
    if severity == "critical":
        domain = gap_result.get("domain_tag", "此领域")
        total = gap_result.get("total_nodes", 0)
        if total <= 2:
            return (f"⚠️ 知识缺口严重：用户知识树几乎为空（共{total}个节点）。"
                    f"如果用户在当前主题上卡住，主动建议他先去创建前置知识点（给1-2个具体建议）。"
                    f"这不是拒绝用户，而是帮他建立正确的学习路径。")
        return (f"⚠️ 知识缺口严重：用户在「{domain}」领域几乎没有相关知识积累。"
                f"如果用户卡住，主动建议他先去创建此领域的基础知识点。")
    elif severity == "moderate":
        return "📖 用户在此领域有一些基础，可以用他已掌握的概念做类比。"
    return ""


def should_check_gaps(session: dict) -> bool:
    """Determine if gap detection should run this turn.

    Runs on turn 1, then every 3 turns thereafter.
    """
    user_turn_count = sum(1 for m in session.get("messages", []) if m["role"] == "user")
    if user_turn_count == 0:
        return True  # before first turn
    if user_turn_count == 1:
        return True  # after first user message
    # Every 3 turns after
    last_check = session.get("last_gap_check_turn", 0)
    return (user_turn_count - last_check) >= 3
