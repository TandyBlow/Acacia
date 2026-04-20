"""
AI-assisted knowledge node generation service.
Calls SiliconFlow API, parses LLM output, matches parents, creates nodes.
"""
import json
import os
import re
from uuid import uuid4

import httpx
from db import supabase

SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY", "")
SILICONFLOW_MODEL = os.getenv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-7B-Instruct")
_raw_llm_url = os.getenv("LLM_API_URL", "https://api.siliconflow.cn/v1/chat/completions")
# Support both base URL (e.g. https://api.deepseek.com/v1) and full endpoint URL
SILICONFLOW_URL = _raw_llm_url if _raw_llm_url.endswith("/chat/completions") else _raw_llm_url.rstrip("/") + "/chat/completions"

SYSTEM_PROMPT = (
    "你是一个知识点整理助手。用户会输入一些零散的词或句子，你需要："
    "1. 从中识别出1到3个独立的知识点 "
    "2. 为每个知识点生成：name（简短的名称）、content（用markdown格式写的简明解释，包含定义、核心要点、示例，100到200字）、suggested_parent（建议的父分类名称）"
    '3. 只返回JSON，格式为：{"nodes": [{"name": "...", "content": "...", "suggested_parent": "..."}]}'
)


def call_llm(user_input: str) -> str:
    """Call SiliconFlow chat completions API and return the assistant message content."""
    headers = {
        "Authorization": f"Bearer {SILICONFLOW_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": SILICONFLOW_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
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
    """Extract and validate the nodes list from LLM response text."""
    # Try direct JSON parse first
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Try extracting from ```json...``` code block
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
    """Find best matching existing node by bidirectional substring containment.
    Prefer nodes closer to root (parent_id_cache is null)."""
    parent_lower = suggested_parent.lower()
    best_match = None
    best_is_root = False

    for node in existing_nodes:
        name_lower = node["name"].lower()
        if parent_lower in name_lower or name_lower in parent_lower:
            is_root = node.get("parent_id_cache") is None
            # Prefer root nodes; among same level prefer first match
            if best_match is None or (is_root and not best_is_root):
                best_match = node
                best_is_root = is_root

    return best_match


def create_node_with_edge(
    owner_id: str,
    name: str,
    content_markdown: str,
    parent_id: str | None,
    existing_nodes: list[dict],
) -> dict:
    """Create a node in Supabase with its edge. Returns {id, name, parent_id}."""
    # Check sibling name uniqueness — add suffix if needed
    final_name = name
    parent_nodes = [
        n for n in existing_nodes
        if n.get("parent_id_cache") == parent_id and not n.get("is_deleted", False)
    ]
    sibling_names = {n["name"] for n in parent_nodes}
    if final_name in sibling_names:
        final_name = f"{name}（补充）"
        if final_name in sibling_names:
            # Rare: even the suffixed name exists; skip with warning
            return {"id": None, "name": name, "parent_id": parent_id, "skipped": True}

    # Compute sort_order
    if parent_id:
        edge_resp = (
            supabase.table("edges")
            .select("sort_order")
            .eq("parent_id", parent_id)
            .execute()
        )
        max_sort = max((e["sort_order"] for e in edge_resp.data), default=-1)
    else:
        # Root-level: query edges with parent_id = None is tricky,
        # use nodes with parent_id_cache = None instead
        node_resp = (
            supabase.table("nodes")
            .select("id")
            .eq("owner_id", owner_id)
            .is_("parent_id_cache", "null")
            .eq("is_deleted", False)
            .execute()
        )
        max_sort = len(node_resp.data) - 1

    sort_order = max_sort + 1
    node_id = str(uuid4())

    # Insert node
    supabase.table("nodes").insert({
        "id": node_id,
        "owner_id": owner_id,
        "name": final_name,
        "content": {"markdown": content_markdown},
        "parent_id_cache": parent_id,
        "is_deleted": False,
    }).execute()

    # Insert edge
    supabase.table("edges").insert({
        "parent_id": parent_id,
        "child_id": node_id,
        "sort_order": sort_order,
        "relationship_type": "hierarchy",
    }).execute()

    return {"id": node_id, "name": final_name, "parent_id": parent_id}


def ai_generate_nodes(user_input: str, user_id: str) -> dict:
    """Main entry point: generate knowledge nodes from free-form text."""
    # 1. Call LLM
    raw = call_llm(user_input)

    # 2. Parse response
    nodes = parse_llm_json(raw)

    # 3. Fetch existing nodes
    resp = (
        supabase.table("nodes")
        .select("id, name, parent_id_cache")
        .eq("owner_id", user_id)
        .eq("is_deleted", False)
        .execute()
    )
    existing_nodes = resp.data

    # 4. Create nodes
    created = []
    parent_cache: dict[str, dict] = {}  # suggested_parent -> created parent node

    for node in nodes:
        suggested = node["suggested_parent"]

        # Check if we already created a parent for this suggested_parent in this batch
        matched_parent = parent_cache.get(suggested)

        if not matched_parent:
            # Try to find an existing matching node
            match = find_parent_match(suggested, existing_nodes)
            if match:
                matched_parent = match
            else:
                # Create a new root parent node
                parent_result = create_node_with_edge(
                    user_id, suggested, "", None, existing_nodes
                )
                if parent_result.get("skipped"):
                    created.append(parent_result)
                    continue
                # Track the new parent for sibling checks and batch reuse
                new_parent = {
                    "id": parent_result["id"],
                    "name": suggested,
                    "parent_id_cache": None,
                }
                existing_nodes.append(new_parent)
                parent_cache[suggested] = new_parent
                matched_parent = new_parent

        # Create the knowledge node under the matched/created parent
        result = create_node_with_edge(
            user_id,
            node["name"],
            node["content"],
            matched_parent["id"],
            existing_nodes,
        )
        created.append(result)

        # Track the new child node for sibling checks
        if not result.get("skipped"):
            existing_nodes.append({
                "id": result["id"],
                "name": result["name"],
                "parent_id_cache": matched_parent["id"],
            })

    return {"nodes": created}
