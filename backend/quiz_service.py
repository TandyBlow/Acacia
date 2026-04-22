"""
AI quiz question generation service.
Calls SiliconFlow API, parses LLM output, creates quiz questions for nodes.
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
SILICONFLOW_URL = _raw_llm_url if _raw_llm_url.endswith("/chat/completions") else _raw_llm_url.rstrip("/") + "/chat/completions"

QUIZ_SYSTEM_PROMPT = (
    "你是一个出题助手。根据用户提供的知识点，生成一道单选题。"
    "只返回JSON，格式为："
    '{"question": "题干", "options": ["A选项", "B选项", "C选项", "D选项"], "correct_index": 0, "explanation": "解析"}'
    "correct_index是正确答案在options里的下标，从0开始。"
    "题目要考察对知识点的真正理解，不能直接照抄原文。"
)


def call_llm_for_quiz(user_input: str) -> str:
    """Call SiliconFlow chat completions API for quiz generation."""
    headers = {
        "Authorization": f"Bearer {SILICONFLOW_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": SILICONFLOW_MODEL,
        "messages": [
            {"role": "system", "content": QUIZ_SYSTEM_PROMPT},
            {"role": "user", "content": user_input},
        ],
        "temperature": 0.8,
    }
    with httpx.Client(timeout=30) as client:
        resp = client.post(SILICONFLOW_URL, headers=headers, json=payload)
        resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def parse_quiz_json(raw: str) -> dict:
    """Extract and validate quiz question from LLM response text."""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
        if not match:
            raise ValueError("LLM response is not valid JSON")
        parsed = json.loads(match.group(1))

    required_keys = {"question", "options", "correct_index", "explanation"}
    if not all(k in parsed for k in required_keys):
        raise ValueError("LLM response missing required keys")
    if not isinstance(parsed["options"], list) or len(parsed["options"]) != 4:
        raise ValueError("Options must be a list of 4 items")
    if not isinstance(parsed["correct_index"], int) or not (0 <= parsed["correct_index"] <= 3):
        raise ValueError("correct_index must be 0-3")

    return parsed


def generate_quiz_question(node_id: str, user_id: str) -> dict:
    """Generate a quiz question for a specific node (Supabase path)."""
    resp = (
        supabase.table("nodes")
        .select("name, content")
        .eq("id", node_id)
        .eq("owner_id", user_id)
        .eq("is_deleted", False)
        .single()
        .execute()
    )
    if not resp.data:
        raise ValueError("Node not found")

    node = resp.data
    name = node["name"]
    content = node.get("content", {})
    if isinstance(content, dict):
        content = content.get("markdown", str(content))

    user_input = f"知识点名称：{name}\n内容：{content}"
    raw = call_llm_for_quiz(user_input)
    quiz = parse_quiz_json(raw)
    quiz["node_id"] = node_id
    return quiz


def submit_quiz_answer(node_id: str, user_id: str, is_correct: bool) -> dict:
    """Record a quiz answer and update mastery_score (Supabase path)."""
    supabase.table("quiz_records").insert({
        "node_id": node_id,
        "owner_id": user_id,
        "is_correct": is_correct,
    }).execute()

    resp = (
        supabase.table("quiz_records")
        .select("is_correct")
        .eq("node_id", node_id)
        .eq("owner_id", user_id)
        .order("answered_at", desc=True)
        .limit(10)
        .execute()
    )

    records = resp.data or []
    if len(records) > 0:
        correct_count = sum(1 for r in records if r["is_correct"])
        mastery = correct_count / len(records)
    else:
        mastery = 0.0

    supabase.table("nodes").update({"mastery_score": mastery}).eq("id", node_id).execute()

    return {"mastery_score": mastery, "total_records": len(records)}
