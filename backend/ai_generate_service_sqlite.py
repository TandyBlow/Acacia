"""
AI-assisted knowledge node generation service (SQLite version).
Calls SiliconFlow API, parses LLM output, matches parents, creates nodes.
"""
import json
import os
import re
import sqlite3
from uuid import uuid4

import httpx

SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY", "")
SILICONFLOW_MODEL = os.getenv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-7B-Instruct")
_raw_llm_url = os.getenv("LLM_API_URL", "https://api.siliconflow.cn/v1/chat/completions")
SILICONFLOW_URL = _raw_llm_url if _raw_llm_url.endswith("/chat/completions") else _raw_llm_url.rstrip("/") + "/chat/completions"

SYSTEM_PROMPT = (
    "你是一个知识点整理助手。用户会输入一些零散的词或句子，你需要："
    "1. 从中识别出1到3个独立的知识点 "
    "2. 为每个知识点生成：name（简短的名称）、content（用markdown格式写的简明解释，包含定义、核心要点、示例，100到200字）、suggested_parent（建议的父分类名称）"
    '3. 只返回JSON，格式为：{"nodes": [{"name": "...", "content": "...", "suggested_parent": "..."}]}'
)

ANALYSIS_PROMPT = (
    "你是一个知识点分析助手。用户会提供一篇学习笔记（Markdown格式），你需要："
    "1. 仔细阅读笔记内容"
    "2. 从中提取出2到5个关键的子知识点"
    "3. 为每个子知识点生成：name（简短名称，不超过20字）、content（用markdown格式写的简明解释，100到200字，包含定义和核心要点）"
    '4. 只返回JSON，格式为：{"nodes": [{"name": "...", "content": "..."}]}'
    "注意：提取的是笔记中隐含的概念，不是原文照抄。"
)


def call_llm(user_input: str, system_prompt: str = SYSTEM_PROMPT) -> str:
    if not SILICONFLOW_API_KEY:
        raise ValueError("未配置SILICONFLOW_API_KEY环境变量，无法调用AI服务")
    headers = {
        "Authorization": f"Bearer {SILICONFLOW_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": SILICONFLOW_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input},
        ],
        "temperature": 0.7,
    }
    with httpx.Client(timeout=30) as client:
        resp = client.post(SILICONFLOW_URL, headers=headers, json=payload)
        resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def parse_llm_json(raw: str) -> list[dict]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
        if not match:
            raise ValueError("LLM response is not valid JSON")
        parsed = json.loads(match.group(1))

    if not isinstance(parsed, dict) or "nodes" not in parsed:
        raise ValueError("LLM response missing 'nodes' key")

    nodes = parsed["nodes"]
    if not isinstance(nodes, list):
        raise ValueError("'nodes' is not a list")

    for node in nodes:
        if not all(k in node for k in ("name", "content", "suggested_parent")):
            raise ValueError("Each node must have name, content, suggested_parent")

    return nodes


def find_parent_match(suggested_parent: str, existing_nodes: list[dict]) -> dict | None:
    parent_lower = suggested_parent.lower()
    best_match = None
    best_is_root = False

    for node in existing_nodes:
        name_lower = node["name"].lower()
        if parent_lower in name_lower or name_lower in parent_lower:
            is_root = node.get("parent_id") is None
            if best_match is None or (is_root and not best_is_root):
                best_match = node
                best_is_root = is_root

    return best_match


def _create_node_with_edge(
    conn: sqlite3.Connection,
    owner_id: str,
    name: str,
    content_markdown: str,
    parent_id: str | None,
    existing_nodes: list[dict],
) -> dict:
    final_name = name
    parent_nodes = [
        n for n in existing_nodes
        if n.get("parent_id") == parent_id and not n.get("is_deleted", False)
    ]
    sibling_names = {n["name"] for n in parent_nodes}
    if final_name in sibling_names:
        final_name = f"{name}（补充）"
        if final_name in sibling_names:
            return {"id": None, "name": name, "parent_id": parent_id, "skipped": True}

    # Compute sort_order
    row = conn.execute(
        "SELECT COALESCE(MAX(sort_order), -1) FROM nodes WHERE owner_id = ? AND parent_id IS ?",
        (owner_id, parent_id),
    ).fetchone()
    sort_order = row[0] + 1

    node_id = str(uuid4())
    now = datetime_now()

    conn.execute(
        "INSERT INTO nodes (id, owner_id, name, content, parent_id, sort_order, is_deleted, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
        (node_id, owner_id, final_name, content_markdown, parent_id, sort_order, now, now),
    )
    conn.execute(
        "INSERT OR IGNORE INTO edges (parent_id, child_id, sort_order, relationship_type) "
        "VALUES (?, ?, ?, 'parent-child')",
        (parent_id, node_id, sort_order),
    )

    return {"id": node_id, "name": final_name, "parent_id": parent_id}


def datetime_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def parse_analysis_json(raw: str) -> list[dict]:
    """Parse LLM response for node analysis (no suggested_parent)."""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
        if not match:
            raise ValueError("LLM response is not valid JSON")
        parsed = json.loads(match.group(1))

    if not isinstance(parsed, dict) or "nodes" not in parsed:
        raise ValueError("LLM response missing 'nodes' key")

    nodes = parsed["nodes"]
    if not isinstance(nodes, list):
        raise ValueError("'nodes' is not a list")

    for node in nodes:
        if not all(k in node for k in ("name", "content")):
            raise ValueError("Each node must have name, content")

    return nodes


def analyze_node_content_sqlite(node_id: str, owner_id: str, conn: sqlite3.Connection) -> dict:
    """Analyze a node's Markdown content and extract sub-knowledge points as children."""
    row = conn.execute(
        "SELECT name, content FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
        (node_id, owner_id),
    ).fetchone()
    if not row:
        raise ValueError("Node not found")

    name = row["name"]
    content = row["content"] or ""
    if not content.strip():
        raise ValueError("该知识点暂无笔记内容，无法分析")

    user_input = f"知识点名称：{name}\n笔记内容：\n{content}"
    raw = call_llm(user_input, system_prompt=ANALYSIS_PROMPT)
    nodes = parse_analysis_json(raw)

    # Load existing children to avoid name conflicts
    existing_rows = conn.execute(
        "SELECT id, name, parent_id FROM nodes WHERE owner_id = ? AND is_deleted = 0",
        (owner_id,),
    ).fetchall()
    existing_nodes = [
        {"id": r["id"], "name": r["name"], "parent_id": r["parent_id"], "is_deleted": False}
        for r in existing_rows
    ]

    created = []
    for node in nodes:
        result = _create_node_with_edge(
            conn, owner_id, node["name"], node["content"], node_id, existing_nodes
        )
        created.append(result)
        if not result.get("skipped"):
            existing_nodes.append({
                "id": result["id"],
                "name": result["name"],
                "parent_id": node_id,
                "is_deleted": False,
            })

    return {
        "node_id": node_id,
        "node_name": name,
        "created": [c for c in created if not c.get("skipped")],
        "skipped": sum(1 for c in created if c.get("skipped")),
    }


def ai_generate_nodes_sqlite(user_input: str, owner_id: str, conn: sqlite3.Connection) -> dict:
    raw = call_llm(user_input)
    nodes = parse_llm_json(raw)

    rows = conn.execute(
        "SELECT id, name, parent_id FROM nodes WHERE owner_id = ? AND is_deleted = 0",
        (owner_id,),
    ).fetchall()
    existing_nodes = [
        {"id": r["id"], "name": r["name"], "parent_id": r["parent_id"], "is_deleted": False}
        for r in rows
    ]

    created = []
    parent_cache: dict[str, dict] = {}

    for node in nodes:
        suggested = node["suggested_parent"]
        matched_parent = parent_cache.get(suggested)

        if not matched_parent:
            match = find_parent_match(suggested, existing_nodes)
            if match:
                matched_parent = match
            else:
                parent_result = _create_node_with_edge(
                    conn, owner_id, suggested, "", None, existing_nodes
                )
                if parent_result.get("skipped"):
                    created.append(parent_result)
                    continue
                new_parent = {
                    "id": parent_result["id"],
                    "name": suggested,
                    "parent_id": None,
                    "is_deleted": False,
                }
                existing_nodes.append(new_parent)
                parent_cache[suggested] = new_parent
                matched_parent = new_parent

        result = _create_node_with_edge(
            conn, owner_id, node["name"], node["content"], matched_parent["id"], existing_nodes
        )
        created.append(result)

        if not result.get("skipped"):
            existing_nodes.append({
                "id": result["id"],
                "name": result["name"],
                "parent_id": matched_parent["id"],
                "is_deleted": False,
            })

    return {"nodes": created}
