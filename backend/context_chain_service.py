"""
Learning Context Chain service for Acacia.
Tracks user navigation across knowledge points and builds contextual
awareness for AI-generated adaptive openings.
"""
import json
import time
from typing import Dict, Any, List
from uuid import uuid4

import httpx
import os

from database import get_db_ctx

# DeepSeek API configuration (shared with chat_service)
LLM_API_KEY = os.getenv("LLM_API_KEY")
if not LLM_API_KEY:
    raise RuntimeError("LLM_API_KEY 环境变量未设置")
LLM_BASE_URL = "https://api.deepseek.com"
LLM_MODEL = "deepseek-chat"


def _call_deepseek_raw(messages: List[Dict[str, str]], temperature: float = 0.7) -> str:
    headers = {
        "Authorization": f"Bearer {LLM_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(f"{LLM_BASE_URL}/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


# Reuse JSON parsing from chat_service
from chat_service import parse_json_response


# ── Transition recording ──────────────────────────────────────────────

def record_transition(
    owner_id: str,
    from_node_id: str | None,
    to_node_id: str,
    transition_type: str = "navigation",
    reason: str = "",
    session_id: str | None = None
) -> str:
    tid = str(uuid4())
    with get_db_ctx() as conn:
        conn.execute(
            """INSERT INTO context_transitions (id, owner_id, from_node_id, to_node_id,
               transition_type, reason, session_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (tid, owner_id, from_node_id, to_node_id, transition_type, reason, session_id),
        )
    return tid


def get_recent_transitions(owner_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    with get_db_ctx() as conn:
        rows = conn.execute(
            """SELECT * FROM context_transitions
               WHERE owner_id = ?
               ORDER BY created_at DESC LIMIT ?""",
            (owner_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_chain_to_node(owner_id: str, to_node_id: str, max_depth: int = 5) -> List[Dict[str, Any]]:
    """Walk backwards through transitions to build the chain that led to this node."""
    chain: List[Dict[str, Any]] = []
    current_to = to_node_id
    visited = set()
    with get_db_ctx() as conn:
        for _ in range(max_depth):
            row = conn.execute(
                """SELECT ct.*, n.name as to_node_name,
                   n2.name as from_node_name
                   FROM context_transitions ct
                   LEFT JOIN nodes n ON ct.to_node_id = n.id
                   LEFT JOIN nodes n2 ON ct.from_node_id = n2.id
                   WHERE ct.owner_id = ? AND ct.to_node_id = ?
                   ORDER BY ct.created_at DESC LIMIT 1""",
                (owner_id, current_to),
            ).fetchone()
            if not row:
                break
            r = dict(row)
            if r["id"] in visited:
                break
            visited.add(r["id"])
            chain.append(r)
            if not r["from_node_id"]:
                break
            current_to = r["from_node_id"]
    chain.reverse()
    return chain


def get_new_learnings_since_last_visit(
    owner_id: str,
    node_id: str
) -> List[Dict[str, Any]]:
    """Find what was learned in other nodes since the last visit to node_id."""
    with get_db_ctx() as conn:
        # Find the most recent transition TO node_id
        last_visit = conn.execute(
            """SELECT created_at FROM context_transitions
               WHERE owner_id = ? AND to_node_id = ?
               ORDER BY created_at DESC LIMIT 1""",
            (owner_id, node_id),
        ).fetchone()

        if not last_visit:
            return []

        # Find learning snapshots in OTHER nodes created after that timestamp
        rows = conn.execute(
            """SELECT nls.*, n.name as node_name
               FROM node_learning_snapshots nls
               JOIN nodes n ON nls.node_id = n.id
               WHERE nls.owner_id = ? AND nls.node_id != ?
                 AND nls.created_at > ?
               ORDER BY nls.created_at DESC LIMIT 3""",
            (owner_id, node_id, last_visit["created_at"]),
        ).fetchall()

    return [dict(r) for r in rows]


# ── Learning snapshots ────────────────────────────────────────────────

def record_learning_snapshot(
    owner_id: str,
    node_id: str,
    session_id: str,
    learned_concepts: str = "",
    mastery_changes: List[Dict[str, str]] | None = None,
    created_nodes: List[str] | None = None,
    knowledge_notes: str = ""
) -> str:
    sid = str(uuid4())
    with get_db_ctx() as conn:
        conn.execute(
            """INSERT INTO node_learning_snapshots
               (id, owner_id, node_id, session_id, learned_concepts,
                mastery_changes, created_nodes, knowledge_notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                sid, owner_id, node_id, session_id, learned_concepts,
                json.dumps(mastery_changes or [], ensure_ascii=False),
                json.dumps(created_nodes or [], ensure_ascii=False),
                knowledge_notes,
            ),
        )
    return sid


# ── Transition context builder ────────────────────────────────────────

def build_transition_context_text(
    owner_id: str,
    current_node_id: str,
    previous_node_id: str | None,
    transition_type: str,
    transition_reason: str
) -> str:
    """Build a natural-language context string describing the user's journey."""
    with get_db_ctx() as conn:
        cur_name = _node_name(conn, current_node_id) or "未知知识点"
        prev_name = _node_name(conn, previous_node_id) if previous_node_id else None

    type_labels = {
        "navigation": "导航",
        "mark_concept": "标记概念",
        "return": "返回",
        "initial": "首次进入",
    }
    type_label = type_labels.get(transition_type, transition_type)

    parts = []
    if prev_name:
        parts.append(f"用户从「{prev_name}」通过{type_label}跳转到「{cur_name}」。")
    else:
        parts.append(f"用户首次进入「{cur_name}」。")

    if transition_reason:
        parts.append(f"跳转原因：{transition_reason}")

    # Also include the full chain for deeper context
    chain = get_chain_to_node(owner_id, current_node_id, max_depth=5)
    if len(chain) >= 2:
        chain_names = []
        for t in chain:
            name = t.get("to_node_name") or t["to_node_id"]
            chain_names.append(name)
        parts.append(f"完整学习路径：{' → '.join(chain_names)}")

    return "\n".join(parts)


def _node_name(conn, node_id: str) -> str | None:
    row = conn.execute("SELECT name FROM nodes WHERE id = ?", (node_id,)).fetchone()
    return row["name"] if row else None


# ── Adaptive opening generation ───────────────────────────────────────

ADAPTIVE_OPENING_SYSTEM = """你是一个智能导师，需要为用户进入一个新知识点生成自然的开场白。

开场白策略（根据用户知识背景选择）：

1. 用户知识图谱为空 → 直接点出用户没学过这个领域：
   "我看你没学过{current_topic}相关的内容，你了解它吗？不了解的话，接下来的学习可能对你来说有点困难。"
   或 "你对{current_topic}了解多少？如果完全没接触过的话，我们得从最基础的概念开始。"

2. 有其他领域知识但无当前领域 → 桥梁型（1-2句）：
   "你之前学过{related_topics}，但看起来还没接触过{current_topic}。不过有前面的基础，理解起来不会太难。你知道{current_topic}是什么吗？"

3. 从其他节点跳转过来 → 衔接型（1句）：
   "你是因为{previous_topic}里遇到了{current_topic}才来这的。我们直接用{previous_topic}里的场景来讲。"

4. 返回之前学过的节点 → 回顾更新型（1-2句）：
   "你刚在{other_nodes}学到了{new_concepts}，现在回来看{current_topic}应该轻松多了。我们继续？"

5. 跳转原因明确（如标记概念） → 实用导向型（1句）：
   "你在学{previous_topic}时标记了{current_topic}这个概念，我们来把它弄清楚。"

铁律：
- 不超过2句话，能1句说完就1句
- 绝不说"好的"、"你好"、"我们开始"、"今天"、"首先"、"接下来"
- 不确定用户水平时，先问他了解多少，不要假设他懂或不懂
- 不要总结文档内容，不要列举文档结构
- 如果用户知识图谱显示他完全没学过这个领域，直接说"我看你没学过X"
- 如果知识点名称是纯大写缩写（如OML、SGD），且无法从资料中确定含义，开场白必须是确认型问句："你先告诉我XX是啥"或"你知道XX是啥吗"
- 如果知识档案中有某个术语无法从文件内容中验证，以文件内容为准，不要强行关联知识档案中的标签
- 知识档案中的节点名称是用户自己起的标签，可能是临时组织用途（如"小组作业理解""随便看看"）而非真正的知识主题。开场白中不要引用明显是临时标签的节点名称。如果知识路径中有"理解""作业""临时""测试""随便""看看""笔记""草稿""应付"等非知识性词汇，跳过这些节点，不要将其当作知识背景来介绍。

返回JSON：
{
  "opening_message": "自然开场白（1-2句），以问句结尾",
  "opening_sub_topic": "当前讨论的子话题名称",
  "opening_action": "question"
}"""


def generate_adaptive_opening(
    owner_id: str,
    node_id: str,
    node_name: str,
    previous_node_id: str | None = None,
    transition_type: str = "initial",
    transition_reason: str = "",
    reference_text: str = ""
) -> Dict[str, Any]:
    """Call DeepSeek to generate an adaptive opening message for the chat."""

    # Build context for the opening generator
    from chat_service import build_knowledge_profile

    knowledge_profile = build_knowledge_profile(owner_id, node_id)

    # Build transition context
    transition_ctx = build_transition_context_text(
        owner_id, node_id, previous_node_id, transition_type, transition_reason
    )

    # Check for new learnings (for return visits)
    new_learnings_text = ""
    if transition_type == "return" or previous_node_id:
        new_learnings = get_new_learnings_since_last_visit(owner_id, node_id)
        if new_learnings:
            parts = []
            for nl in new_learnings:
                parts.append(f"  - 在「{nl.get('node_name', '未知')}」中学习了：{nl.get('learned_concepts', '')}")
            new_learnings_text = "\n".join(parts)

    # Get previous node content as potential example material
    prev_node_context = ""
    if previous_node_id:
        with get_db_ctx() as conn:
            row = conn.execute(
                "SELECT name, content FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
                (previous_node_id, owner_id),
            ).fetchone()
            if row:
                content_preview = row["content"][:500] if row["content"] else ""
                prev_node_context = f"上一个知识点的名称：{row['name']}\n上一个知识点的内容摘要：{content_preview}"

    user_parts = [
        f"当前知识点名称：{node_name}",
    ]
    if transition_ctx:
        user_parts.append(f"\n用户跳转背景：\n{transition_ctx}")
    if knowledge_profile:
        user_parts.append(f"\n{knowledge_profile}")
    if new_learnings_text:
        user_parts.append(f"\n自上次访问后的新学习内容：\n{new_learnings_text}")
    if prev_node_context:
        user_parts.append(f"\n{prev_node_context}")
    if reference_text.strip():
        user_parts.append(f"\n参考资料：\n{reference_text[:2000]}")
    user_parts.append("\n请根据以上信息生成自适应开场白，包含第一个引导性问题。严格按照JSON格式回复。")

    messages = [
        {"role": "system", "content": ADAPTIVE_OPENING_SYSTEM},
        {"role": "user", "content": "\n".join(user_parts)},
    ]

    try:
        raw = _call_deepseek_raw(messages, temperature=0.8)
        result = parse_json_response(raw)
    except Exception:
        # Fallback: generate a simple but contextual opening without AI
        return _fallback_opening(
            node_name, previous_node_id, transition_type, transition_reason, owner_id
        )

    return {
        "opening_message": result.get("opening_message", ""),
        "opening_sub_topic": result.get("opening_sub_topic", ""),
        "opening_action": result.get("opening_action", "question"),
    }


def _fallback_opening(
    node_name: str,
    previous_node_id: str | None,
    transition_type: str,
    transition_reason: str,
    owner_id: str
) -> Dict[str, Any]:
    """Generate a rule-based opening when the AI call fails."""
    if transition_type == "mark_concept" and previous_node_id:
        with get_db_ctx() as conn:
            prev_name = _node_name(conn, previous_node_id) or "上一个知识点"
        return {
            "opening_message": f"你在学习「{prev_name}」时标记了「{node_name}」这个概念。让我来帮你深入理解它。你能先说说你对「{node_name}」目前的理解吗？",
            "opening_sub_topic": node_name,
            "opening_action": "question",
        }
    elif previous_node_id and transition_type in ("navigation", "return"):
        with get_db_ctx() as conn:
            prev_name = _node_name(conn, previous_node_id) or "之前的知识点"
        return {
            "opening_message": f"从「{prev_name}」来到「{node_name}」，这两个主题是有关联的。你对「{node_name}」目前了解多少？",
            "opening_sub_topic": node_name,
            "opening_action": "question",
        }
    else:
        # Check if knowledge graph is empty
        from tree_repository_sqlite import fetch_user_nodes_with_knowledge
        nodes = fetch_user_nodes_with_knowledge(owner_id)
        if not nodes or len(nodes) <= 1:
            return {
                "opening_message": f"看起来你还什么都不会，要不要先去学习一下「{node_name}」的相关基础知识？如果你已经学过了，只是没有记录下来，不妨先去简单记录一下，方便我们后续的学习。",
                "opening_sub_topic": node_name,
                "opening_action": "question",
            }
        return {
            "opening_message": f"我们来聊聊「{node_name}」。你目前对它的理解是什么？",
            "opening_sub_topic": node_name,
            "opening_action": "question",
        }


# ── Learning summary generation ───────────────────────────────────────

LEARNING_SUMMARY_SYSTEM = """你是一个学习摘要生成器。根据对话历史，生成这个学习会话的摘要。

返回JSON：
{
  "learned_concepts": "本次对话学习的核心概念（用中文，2-3句话概括）",
  "mastery_changes": [
    {"concept_name": "概念名", "mastery_before": "new/learning/mastered", "mastery_after": "new/learning/mastered"}
  ],
  "knowledge_notes": "基于对话中所有knowledge_note汇总的完整知识笔记"
}"""


def generate_learning_summary(messages: List[Dict[str, Any]], node_name: str) -> Dict[str, Any]:
    """Generate a learning summary from conversation messages."""
    history = []
    for msg in messages[-30:]:
        role_label = "AI" if msg["role"] == "ai" else "用户"
        history.append(f"{role_label}: {msg['content']}")

    user_content = f"知识点名称：{node_name}\n\n对话历史：\n" + "\n".join(history)
    user_content += "\n\n请根据对话历史生成学习摘要。严格按照JSON格式回复。"

    messages_payload = [
        {"role": "system", "content": LEARNING_SUMMARY_SYSTEM},
        {"role": "user", "content": user_content},
    ]

    try:
        raw = _call_deepseek_raw(messages_payload, temperature=0.5)
        return parse_json_response(raw)
    except Exception:
        return {
            "learned_concepts": f"围绕「{node_name}」进行了对话学习",
            "mastery_changes": [],
            "knowledge_notes": "",
        }
