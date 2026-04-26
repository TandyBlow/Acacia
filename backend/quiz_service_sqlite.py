"""
AI quiz question generation service — SQLite variant.
"""
import json
import os
import re
from uuid import uuid4

import httpx
import sqlite3

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


def generate_quiz_question_sqlite(node_id: str, owner_id: str, conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT name, content FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
        (node_id, owner_id),
    ).fetchone()
    if not row:
        raise ValueError("Node not found")

    name = row["name"]
    content = row["content"] or ""

    user_input = f"知识点名称：{name}\n内容：{content}"
    raw = call_llm_for_quiz(user_input)
    quiz = parse_quiz_json(raw)
    quiz["node_id"] = node_id
    return quiz


def submit_quiz_answer_sqlite(node_id: str, owner_id: str, is_correct: bool, conn: sqlite3.Connection) -> dict:
    record_id = str(uuid4())
    conn.execute(
        "INSERT INTO quiz_records (id, node_id, owner_id, is_correct) VALUES (?, ?, ?, ?)",
        (record_id, node_id, owner_id, 1 if is_correct else 0),
    )

    rows = conn.execute(
        "SELECT is_correct FROM quiz_records WHERE node_id = ? AND owner_id = ? ORDER BY answered_at DESC LIMIT 10",
        (node_id, owner_id),
    ).fetchall()

    if len(rows) > 0:
        correct_count = sum(1 for r in rows if r["is_correct"])
        mastery = correct_count / len(rows)
    else:
        mastery = 0.0

    conn.execute(
        "UPDATE nodes SET mastery_score = ? WHERE id = ?",
        (mastery, node_id),
    )

    return {"mastery_score": mastery, "total_records": len(rows)}
