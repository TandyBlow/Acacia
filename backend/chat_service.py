"""
Single-topic Socratic chat service for Acacia.
Each node gets its own conversation — AI helps the user understand ONE topic
through natural dialogue, referencing the node's title and any provided material.

Reuses DeepSeek API helpers and session persistence from file_knowledge_service.
"""
import json
import time
from typing import List, Dict, Any
from uuid import uuid4

import httpx
import os

from database import get_db_ctx


# DeepSeek API configuration
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-fe13ac5f49fa4b9dae15fb4937387203")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"


def call_deepseek(messages: List[Dict[str, str]]) -> str:
    """Call DeepSeek API with JSON mode enforced."""
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(f"{DEEPSEEK_BASE_URL}/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


# Reuse JSON parsing utilities from file_knowledge_service
import re

def _sanitize_control_chars(text: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)


def _fix_newlines_in_strings(text: str) -> str:
    result = []
    in_string = False
    escape_next = False
    for ch in text:
        if escape_next:
            escape_next = False
            result.append(ch)
            continue
        if ch == '\\' and in_string:
            escape_next = True
            result.append(ch)
            continue
        if ch == '"':
            in_string = not in_string
            result.append(ch)
            continue
        if in_string and ch in ('\n', '\r'):
            result.append('\\n')
            continue
        result.append(ch)
    return ''.join(result)


def _find_json_boundary(text: str, opener: str, closer: str) -> tuple | None:
    start = text.find(opener)
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape_next = False
    for i, ch in enumerate(text[start:], start):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return (start, i + 1)
    return None


def parse_json_response(raw: str) -> dict:
    sanitized = _sanitize_control_chars(raw)
    try:
        return json.loads(sanitized, strict=False)
    except json.JSONDecodeError:
        pass
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", sanitized, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1), strict=False)
        except json.JSONDecodeError:
            pass
    for opener, closer in [("{", "}"), ("[", "]")]:
        boundary = _find_json_boundary(sanitized, opener, closer)
        if boundary is None:
            continue
        start, end = boundary
        candidate = sanitized[start:end]
        candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
        try:
            return json.loads(candidate, strict=False)
        except json.JSONDecodeError:
            pass
    for opener, closer in [("{", "}"), ("[", "]")]:
        boundary = _find_json_boundary(sanitized, opener, closer)
        if boundary is None:
            continue
        start, end = boundary
        candidate = sanitized[start:end]
        candidate = _fix_newlines_in_strings(candidate)
        candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
        try:
            return json.loads(candidate, strict=False)
        except json.JSONDecodeError:
            pass
    preview = raw[:500] if len(raw) > 500 else raw
    raise ValueError(f"LLM response is not valid JSON. Raw preview: {preview}")


# ── Prompts ──────────────────────────────────────────────────────────

SINGLE_TOPIC_CHAT_SYSTEM = """你是一个苏格拉底式导师，帮助用户深入理解一个特定的知识主题。

核心原则：
- 通过自然、多样的引导性问题帮助用户主动思考
- 基于提供的参考资料提问，以资料中的内容为事实依据
- 如果用户回答正确，鼓励并简要补充关键见解
- 如果用户回答部分正确，用追问引导完善
- 如果用户回答错误或说"不知道"，给出包含具体例子或类比的提示
- 不要使用固定模板提问，根据对话的实际情况灵活调整
- 问题长度控制在1-3句话，保持自然对话感

提问策略（交替使用，保持多样性）：
1. 类比提问：将概念与用户可能熟悉的事物关联
2. 反例提问：提出一个看似合理但实际错误的说法，让用户判断
3. 场景提问：设计一个具体场景，问用户如何应用
4. 分层提问：先探基础理解，再深入
5. 对比提问：与相近概念对比
6. 追溯提问：追问"为什么"和"如果不这样会怎样"

可用动作（每次回复必须选择一个）：
- "question"：提出一个新的引导性问题
- "accept"：用户回答准确完整 → 生成笔记内容，然后提出下一个相关问题或结束
- "follow_up"：回答部分正确 → 自然追问
- "hint"：回答错误或说"不知道" → 给出引导性提示
- "show_source"：用户需要参考资料原文 → 直接提供原文相关内容
- "summarize_and_move_on"：多次尝试后仍未掌握 → 给出正确答案并总结

返回JSON格式：
{
  "action": "question|accept|follow_up|hint|show_source|summarize_and_move_on",
  "message": "给用户的回复（自然对话风格）",
  "generated_content": "当action为accept时，生成一段Markdown笔记（100-200字），总结用户对该子话题的理解。必须以用户自己的理解为核心，用标准知识修正偏差，包含具体例子。非accept时为空字符串",
  "sub_topic": "当前讨论的子话题名称（方便用户了解对话焦点），如'梯度下降的直观理解'、'链式法则在反向传播中的应用'等"
}

生成笔记内容的原则：
- 以用户的回答为核心（反映用户自己的理解）
- 补充标准知识确保准确性（如果用户理解有偏差就温和修正）
- 包含一个具体例子或应用场景
- 使用Markdown格式，100-200字
- 语气要自然，像用户自己做的笔记"""


# ── Session persistence ──────────────────────────────────────────────

def _load_session(session_id: str) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT * FROM conversation_sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "session_id": row["id"],
        "node_id": row["node_id"],
        "owner_id": row["owner_id"],
        "file_id": row["file_id"],
        "knowledge_points": json.loads(row["knowledge_points"]),
        "current_index": row["current_index"],
        "messages": json.loads(row["messages"]),
        "generated_content": row["generated_content"],
        "status": row["status"],
        "follow_up_count": row["follow_up_count"],
        "self_correction_count": row["self_correction_count"],
        "uncertainty_count": row["uncertainty_count"],
        "pending_example": json.loads(row["pending_example"]) if row["pending_example"] else None,
        "example_history": json.loads(row["example_history"]),
        "created_at": row["created_at"],
        "last_activity_at": row["last_activity_at"],
    }


def _save_session(session: dict):
    with get_db_ctx() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO conversation_sessions
               (id, owner_id, node_id, file_id, knowledge_points, current_index,
                messages, generated_content, status, follow_up_count,
                self_correction_count, uncertainty_count, pending_example,
                example_history, created_at, last_activity_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session["session_id"],
                session["owner_id"],
                session["node_id"],
                session["file_id"],
                json.dumps(session["knowledge_points"], ensure_ascii=False),
                session["current_index"],
                json.dumps(session["messages"], ensure_ascii=False),
                session["generated_content"],
                session["status"],
                session["follow_up_count"],
                session["self_correction_count"],
                session["uncertainty_count"],
                json.dumps(session["pending_example"], ensure_ascii=False) if session.get("pending_example") else None,
                json.dumps(session.get("example_history", []), ensure_ascii=False),
                session["created_at"],
                session["last_activity_at"],
            ),
        )


# ── Public API ───────────────────────────────────────────────────────

def start_chat(
    node_id: str,
    owner_id: str,
    node_name: str,
    reference_text: str = "",
    file_id: str = ""
) -> Dict[str, Any]:
    """Start a new Socratic chat. Multi-KP extraction when file_id is provided."""
    session_id = str(uuid4())

    # Try multi-KP extraction if file is provided
    knowledge_points = []
    if file_id:
        try:
            from file_knowledge_service import extract_knowledge_points
            result = extract_knowledge_points(file_id, owner_id)
            # Flatten groups into a single ordered list
            for group in result.get("groups", []):
                knowledge_points.extend(group.get("knowledge_points", []))
        except Exception:
            knowledge_points = []

    if knowledge_points:
        return _start_multi_kp(session_id, node_id, owner_id, file_id, knowledge_points)
    else:
        return _start_single_topic(session_id, node_id, owner_id, node_name, reference_text, file_id)


def _start_single_topic(
    session_id: str,
    node_id: str,
    owner_id: str,
    node_name: str,
    reference_text: str,
    file_id: str
) -> Dict[str, Any]:
    """Start a single-topic Socratic chat (original behavior)."""
    session = {
        "session_id": session_id,
        "node_id": node_id,
        "owner_id": owner_id,
        "file_id": file_id,
        "knowledge_points": [{"id": "topic", "title": node_name, "type": "concept"}],
        "current_index": 0,
        "messages": [],
        "generated_content": "",
        "status": "active",
        "created_at": time.time(),
        "last_activity_at": time.time(),
        "follow_up_count": 0,
        "self_correction_count": 0,
        "uncertainty_count": 0,
        "pending_example": None,
        "example_history": [],
        "chat_mode": "single",
    }

    full_reference = reference_text
    if file_id:
        full_reference = _read_uploaded_file(owner_id, file_id) or reference_text

    user_content = f"节点名称：{node_name}\n\n"
    if full_reference.strip():
        user_content += f"参考资料：\n{full_reference}\n\n"
    user_content += "请开始苏格拉底式对话。先简要介绍这个主题（1-2句话），然后提出第一个引导性问题。请严格按照系统提示的JSON格式回复。"

    messages = [
        {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
        {"role": "user", "content": user_content}
    ]

    try:
        raw = call_deepseek(messages)
        result = parse_json_response(raw)
    except Exception as e:
        raise RuntimeError(f"启动对话失败：{str(e)}")

    ai_message = result.get("message", "")
    action = result.get("action", "question")

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "sub_topic": result.get("sub_topic", "")}
    })

    _save_session(session)

    return {
        "session_id": session_id,
        "question": ai_message,
        "action": action,
        "sub_topic": result.get("sub_topic", ""),
        "total_kp": 1,
        "current_kp_index": 0,
        "kp_title": node_name,
        "kp_type": "concept",
    }


def _start_multi_kp(
    session_id: str,
    node_id: str,
    owner_id: str,
    file_id: str,
    knowledge_points: list
) -> Dict[str, Any]:
    """Start a multi-KP conversation by generating the first question."""
    from file_knowledge_service import generate_question_for_knowledge_point

    session = {
        "session_id": session_id,
        "node_id": node_id,
        "owner_id": owner_id,
        "file_id": file_id,
        "knowledge_points": knowledge_points,
        "current_index": 0,
        "messages": [],
        "generated_content": "",
        "status": "active",
        "created_at": time.time(),
        "last_activity_at": time.time(),
        "follow_up_count": 0,
        "self_correction_count": 0,
        "uncertainty_count": 0,
        "pending_example": None,
        "example_history": [],
        "chat_mode": "multi_kp",
    }

    first_kp = knowledge_points[0]
    try:
        question_data = generate_question_for_knowledge_point(first_kp)
    except Exception as e:
        raise RuntimeError(f"生成第一个问题失败：{str(e)}")

    session["messages"].append({
        "role": "ai",
        "content": question_data["question"],
        "timestamp": time.time(),
        "metadata": {
            "kp_id": first_kp["id"],
            "hints": question_data.get("hints", []),
        }
    })

    _save_session(session)

    return {
        "session_id": session_id,
        "question": question_data["question"],
        "hints": question_data.get("hints", []),
        "action": "question",
        "sub_topic": first_kp.get("title", ""),
        "total_kp": len(knowledge_points),
        "current_kp_index": 0,
        "kp_title": first_kp.get("title", ""),
        "kp_type": first_kp.get("type", ""),
        "kp_data": {
            "source_content": first_kp.get("source_content", ""),
            "correct_definition": first_kp.get("correct_definition", ""),
            "key_example": first_kp.get("key_example", ""),
        },
    }


def process_chat_turn(
    session_id: str,
    user_answer: str,
    skip: bool = False
) -> Dict[str, Any]:
    """Process one turn of a chat. Dispatches to single-topic or multi-KP handler."""
    session = _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    session["last_activity_at"] = time.time()

    if session.get("chat_mode") == "multi_kp":
        return _process_multi_kp_turn(session, user_answer, skip)
    else:
        return _process_single_topic_turn(session, user_answer, skip)


def _process_single_topic_turn(
    session: dict,
    user_answer: str,
    skip: bool
) -> Dict[str, Any]:
    """Process one turn of a single-topic Socratic chat (original behavior)."""
    # Add user message
    session["messages"].append({
        "role": "user",
        "content": user_answer,
        "timestamp": time.time(),
    })

    if skip:
        session["messages"].append({
            "role": "ai",
            "content": "好的，我们换一个角度。",
            "timestamp": time.time(),
            "metadata": {"action": "skip"}
        })
        eval_messages = [
            {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
            {"role": "user", "content": _build_conversation_context(session) + "\n\n用户选择跳过当前问题。请换一个角度提出新的引导性问题。请严格按照系统提示的JSON格式回复。"}
        ]
        try:
            raw = call_deepseek(eval_messages)
            result = parse_json_response(raw)
        except Exception as e:
            raise RuntimeError(f"对话处理失败：{str(e)}")

        ai_message = result.get("message", "")
        session["messages"][-1] = {
            "role": "ai",
            "content": ai_message,
            "timestamp": time.time(),
            "metadata": {"action": "question", "sub_topic": result.get("sub_topic", "")}
        }
        _save_session(session)
        return {
            "action": "question",
            "ai_message": ai_message,
            "sub_topic": result.get("sub_topic", ""),
            "generated_content": "",
            "total_kp": 1,
            "current_kp_index": 0,
        }

    # Evaluate user's answer
    eval_messages = [
        {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
        {"role": "user", "content": _build_conversation_context(session) + f"\n\n用户刚才的回答：{user_answer}\n\n请评估用户的回答，选择动作并回复。请严格按照系统提示的JSON格式回复。"}
    ]

    try:
        raw = call_deepseek(eval_messages)
        result = parse_json_response(raw)
    except Exception as e:
        raise RuntimeError(f"对话处理失败：{str(e)}")

    action = result.get("action", "follow_up")
    ai_message = result.get("message", "")
    generated_content = result.get("generated_content", "")

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "sub_topic": result.get("sub_topic", "")}
    })

    if generated_content:
        if session["generated_content"]:
            session["generated_content"] += "\n\n"
        sub_topic = result.get("sub_topic", "")
        if sub_topic:
            session["generated_content"] += f"## {sub_topic}\n\n{generated_content}"
        else:
            session["generated_content"] += generated_content

    _save_session(session)

    return {
        "action": action,
        "ai_message": ai_message,
        "generated_content": generated_content,
        "sub_topic": result.get("sub_topic", ""),
        "total_kp": 1,
        "current_kp_index": 0,
    }


def _process_multi_kp_turn(
    session: dict,
    user_answer: str,
    skip: bool
) -> Dict[str, Any]:
    """Process one turn of a multi-KP conversation."""
    from file_knowledge_service import (
        evaluate_user_answer,
        generate_content_from_answer,
        generate_question_for_knowledge_point,
    )

    knowledge_points = session["knowledge_points"]
    current_index = session["current_index"]
    current_kp = knowledge_points[current_index]

    # Add user message
    session["messages"].append({
        "role": "user",
        "content": user_answer,
        "timestamp": time.time(),
    })

    # Handle skip
    if skip:
        session["current_index"] += 1
        session["follow_up_count"] = 0

        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            _save_session(session)
            return _make_multi_kp_response(session, "completed", "所有知识点已完成！",
                                           generated_content=session["generated_content"],
                                           completed=True)

        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)
        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
        })
        _save_session(session)
        return _make_multi_kp_response(session, "next_question", question_data["question"],
                                       hints=question_data.get("hints", []))

    # Find the last question for this KP
    last_question = None
    for msg in reversed(session["messages"]):
        if msg["role"] == "ai" and msg.get("metadata", {}).get("kp_id") == current_kp["id"]:
            last_question = msg["content"]
            break

    # Evaluate user's answer
    evaluation = evaluate_user_answer(
        current_kp,
        last_question or "",
        user_answer,
        session["follow_up_count"]
    )

    action = evaluation["action"]
    ai_message = evaluation["next_message"]

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "reason": evaluation.get("reason", "")}
    })

    # Actions that move to the next KP
    if action in ("accept", "summarize_and_move_on"):
        # Generate content for this KP
        kp_messages = _get_kp_messages(session, current_kp["id"])
        generated_content = generate_content_from_answer(
            current_kp,
            last_question or "",
            user_answer,
            kp_messages
        )

        # Append to accumulated content
        if session["generated_content"]:
            session["generated_content"] += "\n\n---\n\n"
        session["generated_content"] += f"## {current_kp['title']}\n\n{generated_content}"

        # Enrich acceptance message with key example
        if action == "accept" and current_kp.get('key_example') and current_kp['key_example'] not in ai_message:
            ai_message += f"\n\n举个具体例子：{current_kp['key_example']}"
            session["messages"][-1]["content"] = ai_message

        # Move to next KP
        session["current_index"] += 1
        session["follow_up_count"] = 0

        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            _save_session(session)
            return _make_multi_kp_response(session, "completed", ai_message,
                                           generated_content=generated_content,
                                           total_content=session["generated_content"],
                                           completed=True)

        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)
        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
        })

        _save_session(session)
        return _make_multi_kp_response(session, "accept_and_next", ai_message,
                                       generated_content=generated_content,
                                       next_question=question_data["question"],
                                       hints=question_data.get("hints", []))

    elif action in ("follow_up", "progressive_hint"):
        session["follow_up_count"] += 1
        _save_session(session)
        return _make_multi_kp_response(session, "follow_up", ai_message)

    elif action == "hint":
        _save_session(session)
        return _make_multi_kp_response(session, "hint", ai_message)

    elif action == "show_source":
        _save_session(session)
        return _make_multi_kp_response(session, "show_source", ai_message)

    elif action == "correct_self":
        session["self_correction_count"] += 1
        if session["self_correction_count"] > 2:
            # Force move to next KP
            session["current_index"] += 1
            session["follow_up_count"] = 0
            session["self_correction_count"] = 0
            if session["current_index"] >= len(knowledge_points):
                session["status"] = "completed"
                _save_session(session)
                return _make_multi_kp_response(session, "completed",
                                               ai_message + "\n\n（已自动跳过，让我们继续下一个知识点。）",
                                               completed=True)
            next_kp = knowledge_points[session["current_index"]]
            question_data = generate_question_for_knowledge_point(next_kp)
            session["messages"].append({
                "role": "ai",
                "content": question_data["question"],
                "timestamp": time.time(),
                "metadata": {"kp_id": next_kp["id"], "hints": question_data.get("hints", [])}
            })
            _save_session(session)
            return _make_multi_kp_response(session, "accept_and_next", ai_message,
                                           next_question=question_data["question"],
                                           hints=question_data.get("hints", []))
        _save_session(session)
        return _make_multi_kp_response(session, "correct_self", ai_message)

    elif action == "admit_uncertainty":
        session["uncertainty_count"] += 1
        _save_session(session)
        return _make_multi_kp_response(session, "admit_uncertainty", ai_message,
                                       can_skip=session["uncertainty_count"] >= 1)

    _save_session(session)
    return _make_multi_kp_response(session, "unknown", ai_message)


def _get_kp_messages(session: dict, kp_id: str) -> list:
    """Get conversation messages relevant to a specific knowledge point."""
    kp_messages = []
    for msg in session["messages"]:
        if msg.get("metadata", {}).get("kp_id") == kp_id:
            kp_messages.append(msg)
        elif msg["role"] == "user":
            # Include user messages that come after the KP's AI messages
            if kp_messages:
                kp_messages.append(msg)
    return kp_messages


def _make_multi_kp_response(
    session: dict,
    action: str,
    ai_message: str,
    generated_content: str = "",
    total_content: str = "",
    next_question: str = "",
    hints: list | None = None,
    completed: bool = False,
    can_skip: bool = False
) -> Dict[str, Any]:
    """Build a response dict for multi-KP mode with progress info."""
    knowledge_points = session["knowledge_points"]
    current_index = session["current_index"]
    current_kp = knowledge_points[current_index] if current_index < len(knowledge_points) else {}

    result: Dict[str, Any] = {
        "action": action,
        "ai_message": ai_message,
        "generated_content": generated_content,
        "total_kp": len(knowledge_points),
        "current_kp_index": current_index,
        "kp_title": current_kp.get("title", ""),
        "kp_type": current_kp.get("type", ""),
        "kp_data": {
            "source_content": current_kp.get("source_content", ""),
            "correct_definition": current_kp.get("correct_definition", ""),
            "key_example": current_kp.get("key_example", ""),
        } if current_kp else None,
    }
    if total_content:
        result["total_content"] = total_content
    if next_question:
        result["next_question"] = next_question
    if hints:
        result["hints"] = hints
    if completed:
        result["completed"] = True
    if can_skip:
        result["can_skip"] = can_skip
    return result


def regenerate_with_tree_context(
    session_id: str,
    tree_context: str
) -> Dict[str, Any]:
    """Regenerate the last AI message using current knowledge tree as context."""
    session = _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    session["last_activity_at"] = time.time()

    if not session["messages"]:
        raise ValueError("No messages to regenerate")

    # Remove the last AI message
    last_ai_idx = None
    for i in range(len(session["messages"]) - 1, -1, -1):
        if session["messages"][i]["role"] == "ai":
            last_ai_idx = i
            break

    if last_ai_idx is None:
        raise ValueError("No AI message to regenerate")

    # Keep messages up to (but not including) the last AI message
    kept_messages = session["messages"][:last_ai_idx]
    removed_message = session["messages"][last_ai_idx]

    eval_messages = [
        {"role": "system", "content": SINGLE_TOPIC_CHAT_SYSTEM},
        {"role": "user", "content": _build_conversation_context({**session, "messages": kept_messages}) +
            f"\n\n用户当前的知识树结构：\n{tree_context}\n\n"
            f"请根据用户的知识树重新生成你刚才的回复。利用知识树中的信息来关联用户已知的概念，"
            f"用用户已有知识来类比或对比当前主题。如果知识树中有相关的前置知识，提到它们。"
            f"保持与之前相同的对话节奏。请严格按照系统提示的JSON格式回复。"}
    ]

    try:
        raw = call_deepseek(eval_messages)
        result = parse_json_response(raw)
    except Exception as e:
        raise RuntimeError(f"重新生成失败：{str(e)}")

    action = result.get("action", "question")
    ai_message = result.get("message", "")
    generated_content = result.get("generated_content", "")

    # Replace the old AI message
    session["messages"][last_ai_idx] = {
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "sub_topic": result.get("sub_topic", ""), "regenerated": True}
    }

    # If the removed message had generated content, remove it from accumulated
    # (simplification: only regenerate the message, don't touch accumulated content)

    _save_session(session)

    return {
        "action": action,
        "ai_message": ai_message,
        "generated_content": generated_content,
        "sub_topic": result.get("sub_topic", ""),
    }


def mark_concept_node(
    session_id: str,
    concept_name: str,
    owner_id: str
) -> Dict[str, Any]:
    """Create a child node for a concept marked during chat."""
    session = _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    session["last_activity_at"] = time.time()
    parent_id = session["node_id"]
    child_id = str(uuid4())

    with get_db_ctx() as conn:
        # Get parent's depth and owner
        parent = conn.execute(
            "SELECT depth, owner_id FROM nodes WHERE id = ? AND is_deleted = 0",
            (parent_id,)
        ).fetchone()
        if not parent:
            raise ValueError("Parent node not found")

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Create child node
        conn.execute(
            """INSERT INTO nodes (id, owner_id, name, content, parent_id, depth, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, '', ?, ?, 0, ?, ?)""",
            (child_id, owner_id, concept_name, parent_id, parent["depth"] + 1, now, now)
        )

        # Create edge
        conn.execute(
            "INSERT INTO edges (parent_id, child_id, sort_order) VALUES (?, ?, 0)",
            (parent_id, child_id)
        )

    # Add a note to the chat
    session["messages"].append({
        "role": "ai",
        "content": f"已创建子节点「{concept_name}」。你可以随时离开去学习它，回来时我会根据你的知识树更新解释。",
        "timestamp": time.time(),
        "metadata": {"action": "concept_marked", "concept_name": concept_name, "node_id": child_id}
    })

    _save_session(session)

    return {
        "node_id": child_id,
        "name": concept_name,
        "parent_id": parent_id,
    }


def get_chat_session(session_id: str, owner_id: str) -> Dict[str, Any]:
    """Get full chat session state for resume, with ownership validation."""
    session = _load_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")
    if session["owner_id"] != owner_id:
        raise PermissionError("无权访问此会话")

    session["last_activity_at"] = time.time()

    knowledge_points = session.get("knowledge_points", [])
    current_index = session.get("current_index", 0)
    current_kp = knowledge_points[current_index] if current_index < len(knowledge_points) else {}

    return {
        "session_id": session["session_id"],
        "node_id": session["node_id"],
        "file_id": session["file_id"],
        "messages": session["messages"],
        "generated_content": session["generated_content"],
        "status": session["status"],
        "created_at": session["created_at"],
        "last_activity_at": session["last_activity_at"],
        "total_kp": len(knowledge_points),
        "current_kp_index": current_index,
        "kp_title": current_kp.get("title", ""),
        "kp_type": current_kp.get("type", ""),
        "kp_data": {
            "source_content": current_kp.get("source_content", ""),
            "correct_definition": current_kp.get("correct_definition", ""),
            "key_example": current_kp.get("key_example", ""),
        } if current_kp else None,
    }


# ── Helpers ──────────────────────────────────────────────────────────

def _read_uploaded_file(owner_id: str, file_id: str) -> str | None:
    """Read the full text content of an uploaded file from disk."""
    import glob as glob_mod
    from file_parser import parse_file
    upload_dir = f"/tmp/acacia_uploads/{owner_id}"
    pattern = os.path.join(upload_dir, f"{file_id}.*")
    matches = glob_mod.glob(pattern)
    if not matches:
        return None
    try:
        return parse_file(matches[0])
    except Exception:
        return None


def _build_conversation_context(session: dict) -> str:
    """Build conversation context string for the AI prompt."""
    lines = []
    node_name = ""
    kps = session.get("knowledge_points", [])
    if kps:
        node_name = kps[0].get("title", "")

    lines.append(f"当前主题：{node_name}")

    # Include system prompt context about the topic
    if node_name:
        lines.append(f"\n你正在帮助用户理解「{node_name}」。")

    # Include recent conversation (last 20 messages to stay within context)
    messages = session.get("messages", [])
    recent = messages[-20:] if len(messages) > 20 else messages
    if recent:
        lines.append("\n对话历史：")
        for msg in recent:
            role_label = "AI" if msg["role"] == "ai" else "用户"
            lines.append(f"{role_label}: {msg['content']}")

    return "\n".join(lines)
