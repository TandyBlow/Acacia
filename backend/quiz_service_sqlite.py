"""
AI quiz question generation service — SQLite variant.
Supports single_choice, true_false, short_answer, and batch generation.
All generated questions are persisted to quiz_questions table.
"""
import json
import os
import re
from uuid import uuid4

import httpx
import sqlite3

from review_service_sqlite import _update_fsrs_params, _calculate_retrievability

SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY", "")
SILICONFLOW_MODEL = os.getenv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-7B-Instruct")
_raw_llm_url = os.getenv("LLM_API_URL", "https://api.siliconflow.cn/v1/chat/completions")
SILICONFLOW_URL = _raw_llm_url if _raw_llm_url.endswith("/chat/completions") else _raw_llm_url.rstrip("/") + "/chat/completions"

# ── Prompt templates ──────────────────────────────────────────────

SINGLE_CHOICE_PROMPT = (
    "你是一个出题助手。根据用户提供的知识点，生成一道单选题。"
    "只返回JSON，格式为："
    '{"question": "题干", "options": ["A选项", "B选项", "C选项", "D选项"], "correct_index": 0, "explanation": "解析"}'
    "correct_index是正确答案在options里的下标，从0开始。"
    "题目要考察对知识点的真正理解，不能直接照抄原文。"
)

TRUE_FALSE_PROMPT = (
    "你是一个出题助手。根据用户提供的知识点，生成一道判断题。"
    "题目为一个陈述句，用户判断其正确或错误。"
    "只返回JSON，格式为："
    '{"question": "陈述句", "correct_index": 0, "explanation": "解析"}'
    "correct_index: 0表示该陈述正确，1表示该陈述错误。"
    "陈述句不能过于显而易见，要有一定的迷惑性。"
)

SHORT_ANSWER_PROMPT = (
    "你是一个出题助手。根据用户提供的知识点，生成一道简答题。"
    "只返回JSON，格式为："
    '{"question": "题目", "reference_answer": "参考答案要点", "keywords": ["关键词1", "关键词2"]}'
    "题目要求用户用自己的话回答，不能太宽泛也不能太琐碎。"
)

BATCH_PROMPT = (
    "你是一个出题助手。根据用户提供的知识点集合，生成{count}道{type_desc}。"
    "只返回JSON，格式为："
    '{"questions": [{"question": "...", "options": [...], "correct_index": 0, "explanation": "...", "question_type": "..."}]}'
    "题目要考察对知识点的真正理解，不能直接照抄原文。"
    "尽量覆盖不同知识点，不要所有题目都针对同一个知识点。"
)


# ── LLM helpers ───────────────────────────────────────────────────

def call_llm(user_input: str, system_prompt: str, temperature: float = 0.8) -> str:
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
        "temperature": temperature,
    }
    with httpx.Client(timeout=60) as client:
        resp = client.post(SILICONFLOW_URL, headers=headers, json=payload)
        resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def extract_json(raw: str) -> dict:
    """Extract JSON from LLM response, handling markdown fences."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
        if not match:
            raise ValueError("LLM response is not valid JSON")
        return json.loads(match.group(1))


# ── Parse helpers ─────────────────────────────────────────────────

def parse_single_choice(raw: str) -> dict:
    parsed = extract_json(raw)
    required = {"question", "options", "correct_index", "explanation"}
    if not all(k in parsed for k in required):
        raise ValueError("LLM response missing required keys for single_choice")
    if not isinstance(parsed["options"], list) or len(parsed["options"]) != 4:
        raise ValueError("Options must be a list of 4 items")
    if not isinstance(parsed["correct_index"], int) or not (0 <= parsed["correct_index"] <= 3):
        raise ValueError("correct_index must be 0-3")
    parsed["question_type"] = "single_choice"
    return parsed


def parse_true_false(raw: str) -> dict:
    parsed = extract_json(raw)
    required = {"question", "correct_index", "explanation"}
    if not all(k in parsed for k in required):
        raise ValueError("LLM response missing required keys for true_false")
    if parsed["correct_index"] not in (0, 1):
        raise ValueError("correct_index must be 0 or 1 for true_false")
    parsed["options"] = json.dumps(["正确", "错误"])
    parsed["question_type"] = "true_false"
    return parsed


def parse_short_answer(raw: str) -> dict:
    parsed = extract_json(raw)
    required = {"question", "reference_answer", "keywords"}
    if not all(k in parsed for k in required):
        raise ValueError("LLM response missing required keys for short_answer")
    if not isinstance(parsed["keywords"], list):
        raise ValueError("keywords must be a list")
    parsed["options"] = json.dumps({
        "reference_answer": parsed["reference_answer"],
        "keywords": parsed["keywords"],
    })
    parsed["correct_index"] = 0
    parsed["explanation"] = parsed.get("explanation", parsed["reference_answer"])
    parsed["question_type"] = "short_answer"
    return parsed


def parse_batch(raw: str) -> list[dict]:
    parsed = extract_json(raw)
    if "questions" not in parsed or not isinstance(parsed["questions"], list):
        raise ValueError("LLM response missing 'questions' list")
    results = []
    for q in parsed["questions"]:
        q_type = q.get("question_type", "single_choice")
        if q_type == "true_false":
            q["options"] = json.dumps(["正确", "错误"])
            if q.get("correct_index") not in (0, 1):
                q["correct_index"] = 0
        elif q_type == "short_answer":
            q["options"] = json.dumps({
                "reference_answer": q.get("reference_answer", ""),
                "keywords": q.get("keywords", []),
            })
            q["correct_index"] = 0
            q["explanation"] = q.get("explanation", q.get("reference_answer", ""))
        else:
            if "options" not in q or not isinstance(q["options"], list):
                raise ValueError(f"Question missing options: {q}")
            q["options"] = json.dumps(q["options"])
            q["question_type"] = "single_choice"
        if "correct_index" not in q:
            q["correct_index"] = 0
        if "explanation" not in q:
            q["explanation"] = ""
        if "difficulty" not in q:
            q["difficulty"] = "medium"
        results.append(q)
    return results


PARSERS = {
    "single_choice": parse_single_choice,
    "true_false": parse_true_false,
    "short_answer": parse_short_answer,
}

PROMPTS = {
    "single_choice": SINGLE_CHOICE_PROMPT,
    "true_false": TRUE_FALSE_PROMPT,
    "short_answer": SHORT_ANSWER_PROMPT,
}

TYPE_LABELS = {
    "single_choice": "单选题",
    "true_false": "判断题",
    "short_answer": "简答题",
}


# ── Persistence helpers ───────────────────────────────────────────

def _persist_question(
    conn: sqlite3.Connection,
    node_id: str,
    owner_id: str,
    question: str,
    options: str,
    correct_index: int,
    explanation: str,
    question_type: str,
    difficulty: str = "medium",
) -> str:
    qid = str(uuid4())
    conn.execute(
        """INSERT INTO quiz_questions
           (id, node_id, owner_id, question, options, correct_index, explanation, question_type, difficulty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (qid, node_id, owner_id, question, options, correct_index, explanation, question_type, difficulty),
    )
    return qid


def _node_to_input(name: str, content: str) -> str:
    parts = [f"知识点名称：{name}"]
    if content:
        parts.append(f"内容：{content}")
    return "\n".join(parts)


def _collect_node_content(conn: sqlite3.Connection, node_id: str, owner_id: str) -> list[dict]:
    """Recursively collect a node and its descendants' name+content."""
    rows = conn.execute(
        "SELECT id, name, content FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0",
        (owner_id, node_id),
    ).fetchall()
    result = [{"name": rows[0]["name"] if rows else "", "content": ""}]
    if rows:
        result = []
        for r in rows:
            result.append({"name": r["name"], "content": r["content"] or ""})
            result.extend(_collect_node_content(conn, r["id"], owner_id))
    return result


# ── Public API ────────────────────────────────────────────────────

def generate_quiz_question_sqlite(
    node_id: str,
    owner_id: str,
    conn: sqlite3.Connection,
    question_type: str = "single_choice",
    difficulty: str = "medium",
) -> dict:
    """Generate a single question and persist it. Backward-compatible with old signature."""
    row = conn.execute(
        "SELECT name, content FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
        (node_id, owner_id),
    ).fetchone()
    if not row:
        raise ValueError("Node not found")

    user_input = _node_to_input(row["name"], row["content"] or "")

    if question_type not in PARSERS:
        question_type = "single_choice"

    system_prompt = PROMPTS[question_type]
    raw = call_llm(user_input, system_prompt)
    quiz = PARSERS[question_type](raw)

    qid = _persist_question(
        conn, node_id, owner_id,
        question=quiz["question"],
        options=quiz["options"] if isinstance(quiz["options"], str) else json.dumps(quiz["options"]),
        correct_index=quiz["correct_index"],
        explanation=quiz.get("explanation", ""),
        question_type=question_type,
        difficulty=difficulty,
    )
    quiz["id"] = qid
    quiz["node_id"] = node_id

    # Convert options back to list for API response
    if isinstance(quiz["options"], str):
        try:
            quiz["options"] = json.loads(quiz["options"])
        except json.JSONDecodeError:
            pass

    quiz["type_label"] = TYPE_LABELS.get(question_type, "单选题")
    return quiz


def generate_batch_questions_sqlite(
    node_id: str,
    owner_id: str,
    conn: sqlite3.Connection,
    count: int = 5,
    include_children: bool = False,
    question_types: list[str] | None = None,
) -> dict:
    """Generate multiple questions at once, optionally from children too."""
    if question_types is None:
        question_types = ["single_choice"]

    row = conn.execute(
        "SELECT name, content FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
        (node_id, owner_id),
    ).fetchone()
    if not row:
        raise ValueError("Node not found")

    parts = [_node_to_input(row["name"], row["content"] or "")]
    if include_children:
        children = _collect_node_content(conn, node_id, owner_id)
        for child in children:
            parts.append(_node_to_input(child["name"], child["content"]))

    user_input = "\n---\n".join(parts)
    type_desc = "、".join(TYPE_LABELS.get(t, t) for t in question_types)
    system_prompt = BATCH_PROMPT.format(count=count, type_desc=type_desc)
    # Hint the LLM about which types to mix
    type_hint = "、".join(question_types)
    user_input = f"题目类型要求：请生成{type_hint}。\n\n{user_input}"

    raw = call_llm(user_input, system_prompt, temperature=0.9)
    questions = parse_batch(raw)

    results = []
    for q in questions[:count]:
        qtype = q.get("question_type", "single_choice")
        if qtype not in PARSERS:
            qtype = "single_choice"
        qid = _persist_question(
            conn, node_id, owner_id,
            question=q["question"],
            options=q["options"] if isinstance(q["options"], str) else json.dumps(q.get("options", [])),
            correct_index=q["correct_index"],
            explanation=q.get("explanation", ""),
            question_type=qtype,
            difficulty=q.get("difficulty", "medium"),
        )
        result = {
            "id": qid,
            "node_id": node_id,
            "question": q["question"],
            "options": q["options"] if not isinstance(q["options"], str) else json.loads(q["options"]),
            "correct_index": q["correct_index"],
            "explanation": q["explanation"],
            "question_type": qtype,
            "type_label": TYPE_LABELS.get(qtype, "单选题"),
        }
        results.append(result)

    return {"node_id": node_id, "questions": results}


def get_questions_by_node_sqlite(node_id: str, owner_id: str, conn: sqlite3.Connection) -> list[dict]:
    """Get all persisted questions for a node (without revealing correct_index)."""
    rows = conn.execute(
        """SELECT qq.id, qq.question, qq.options, qq.explanation,
                   qq.question_type, qq.difficulty, qq.created_at,
                   COALESCE(qr.is_correct, -1) as last_result
           FROM quiz_questions qq
           LEFT JOIN quiz_records qr ON qr.question_id = qq.id
               AND qr.id = (SELECT id FROM quiz_records
                            WHERE question_id = qq.id AND owner_id = ?
                            ORDER BY answered_at DESC LIMIT 1)
           WHERE qq.node_id = ? AND qq.owner_id = ?
           ORDER BY qq.created_at DESC""",
        (owner_id, node_id, owner_id),
    ).fetchall()

    results = []
    for r in rows:
        options = r["options"]
        try:
            options = json.loads(options)
        except (json.JSONDecodeError, TypeError):
            pass
        results.append({
            "id": r["id"],
            "question": r["question"],
            "options": options,
            "explanation": r["explanation"],
            "question_type": r["question_type"],
            "type_label": TYPE_LABELS.get(r["question_type"], "单选题"),
            "difficulty": r["difficulty"],
            "created_at": r["created_at"],
            "answered": r["last_result"] != -1,
            "last_correct": r["last_result"] == 1,
        })
    return results


def get_wrong_questions_sqlite(owner_id: str, conn: sqlite3.Connection, limit: int = 20) -> list[dict]:
    """Get questions the user got wrong, ordered by most recent wrong answer."""
    rows = conn.execute(
        """SELECT DISTINCT qq.id, qq.node_id, qq.question, qq.options, qq.explanation,
                   qq.question_type, qq.difficulty, qq.created_at
           FROM quiz_questions qq
           INNER JOIN quiz_records qr ON qr.question_id = qq.id
           WHERE qq.owner_id = ? AND qr.is_correct = 0
           ORDER BY qr.answered_at DESC
           LIMIT ?""",
        (owner_id, limit),
    ).fetchall()

    results = []
    for r in rows:
        options = r["options"]
        try:
            options = json.loads(options)
        except (json.JSONDecodeError, TypeError):
            pass
        results.append({
            "id": r["id"],
            "node_id": r["node_id"],
            "question": r["question"],
            "options": options,
            "explanation": r["explanation"],
            "question_type": r["question_type"],
            "type_label": TYPE_LABELS.get(r["question_type"], "单选题"),
            "difficulty": r["difficulty"],
        })
    return results


def get_single_question_sqlite(question_id: str, owner_id: str, conn: sqlite3.Connection) -> dict:
    """Get a single question by ID, including correct_index for quiz mode."""
    row = conn.execute(
        "SELECT id, node_id, question, options, correct_index, explanation, question_type, difficulty, created_at "
        "FROM quiz_questions WHERE id = ? AND owner_id = ?",
        (question_id, owner_id),
    ).fetchone()
    if not row:
        raise ValueError("Question not found")

    options = row["options"]
    try:
        options = json.loads(options)
    except (json.JSONDecodeError, TypeError):
        pass

    return {
        "id": row["id"],
        "node_id": row["node_id"],
        "question": row["question"],
        "options": options,
        "correct_index": row["correct_index"],
        "explanation": row["explanation"],
        "question_type": row["question_type"],
        "type_label": TYPE_LABELS.get(row["question_type"], "单选题"),
        "difficulty": row["difficulty"],
    }


def submit_quiz_answer_sqlite(
    node_id: str,
    owner_id: str,
    is_correct: bool,
    conn: sqlite3.Connection,
    question_id: str | None = None,
) -> dict:
    """Submit an answer and update mastery_score via FSRS. question_id is optional for backward compat."""
    record_id = str(uuid4())
    conn.execute(
        "INSERT INTO quiz_records (id, node_id, owner_id, question_id, is_correct) VALUES (?, ?, ?, ?, ?)",
        (record_id, node_id, owner_id, question_id, 1 if is_correct else 0),
    )

    # Map quiz answer to FSRS rating: correct=Good(3), wrong=Again(1)
    rating = 3 if is_correct else 1
    fsrs_result = _update_fsrs_params(conn, node_id, rating)

    return {
        "mastery_score": fsrs_result["mastery_score"],
        "stability": fsrs_result["stability"],
        "retrievability": fsrs_result["retrievability"],
        "review_count": fsrs_result["review_count"],
        "next_review_at": fsrs_result["next_review_at"],
    }


# ── Quiz statistics ───────────────────────────────────────────────

def get_quiz_stats_sqlite(owner_id: str, conn: sqlite3.Connection) -> dict:
    """Get quiz statistics: per-node mastery (dynamic R(t)) and question counts."""
    rows = conn.execute(
        "SELECT id, name, stability, last_review_at, difficulty, review_count, review_state, depth FROM nodes WHERE owner_id = ? AND is_deleted = 0",
        (owner_id,),
    ).fetchall()

    nodes = []
    for r in rows:
        S = float(r["stability"] or 0)
        last = r["last_review_at"] or None
        R = _calculate_retrievability(S, last)
        q_count = conn.execute(
            "SELECT COUNT(*) FROM quiz_questions WHERE node_id = ? AND owner_id = ?",
            (r["id"], owner_id),
        ).fetchone()[0]
        nodes.append({
            "id": r["id"],
            "name": r["name"],
            "mastery_score": round(R, 4),
            "stability": round(S, 4),
            "difficulty": round(float(r["difficulty"] or 0.3), 4),
            "review_count": int(r["review_count"] or 0),
            "review_state": r["review_state"] or "new",
            "depth": r["depth"],
            "question_count": q_count,
        })

    total_questions = conn.execute(
        "SELECT COUNT(*) FROM quiz_questions WHERE owner_id = ?", (owner_id,),
    ).fetchone()[0]

    total_answers = conn.execute(
        "SELECT COUNT(*) FROM quiz_records WHERE owner_id = ?", (owner_id,),
    ).fetchone()[0]

    return {
        "nodes": nodes,
        "total_questions": total_questions,
        "total_answers": total_answers,
    }
