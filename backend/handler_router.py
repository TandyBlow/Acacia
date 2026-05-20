"""
Handler router for the refactored chat architecture.
Maps (chat_mode, intent) pairs to narrow handler functions.
Each handler builds a focused prompt, calls the LLM, and returns a standardized result.
"""
import time
from typing import Dict, Any

from handler_prompts import (
    LINE_BY_LINE_EXPLAIN_SYSTEM,
    LINE_BY_LINE_ANSWER_SYSTEM,
    build_line_by_line_explain_prompt,
    build_line_by_line_answer_prompt,
    build_socratic_question_prompt,
    build_socratic_evaluate_prompt,
    build_socratic_end_prompt,
    build_knowledge_gap_prompt,
)
from doc_position_tracker import (
    get_current_segment,
    advance_position,
    get_progress_context,
    is_document_done,
)
from chat_service import (
    call_deepseek,
    parse_json_response,
    build_knowledge_profile,
    _get_node_content_tail,
)


# ── Routing Table ─────────────────────────────────────────────────────

# Maps (chat_mode, intent) → handler_function
_ROUTE_TABLE: Dict[tuple, callable] = {}


def _register(chat_mode: str, intent: str):
    """Decorator to register a handler in the routing table."""
    def decorator(fn):
        _ROUTE_TABLE[(chat_mode, intent)] = fn
        return fn
    return decorator


# ── Line-by-Line Mode Handlers ────────────────────────────────────────

@_register("line_by_line", "confirmation")
@_register("line_by_line", "skip_request")
def handle_line_by_line_explain(session: dict, user_input: str, intent: str,
                                 tone: dict, gap_warning: str) -> dict:
    """User said 'continue' or 'skip' — advance and explain next segment."""
    if is_document_done(session):
        return _end_line_by_line_result(session, "文档已经讲解完毕。")

    current_segment = get_current_segment(session)
    progress = get_progress_context(session)

    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")
    profile = build_knowledge_profile(oid, nid) if oid and nid else ""

    recent = _recent_history(session, 6)
    messages = build_line_by_line_explain_prompt(
        current_segment=current_segment,
        progress=progress,
        knowledge_profile=profile,
        gap_warning=gap_warning,
        tone_instruction=tone.get("instruction", ""),
        recent_history=recent,
    )

    raw = call_deepseek(messages)
    result = parse_json_response(raw)

    ai_message = result.get("message", "")
    action = result.get("action", "explain")

    advance_position(session)
    if is_document_done(session):
        action = "end_explanation"

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "reason": result.get("reason", "")},
    })

    return {
        "action": action,
        "ai_message": ai_message,
        "sub_topic": result.get("reason", ""),
        "generated_content": "",
        "knowledge_note": "",
        "completed": action == "end_explanation",
    }


@_register("line_by_line", "content_question")
@_register("line_by_line", "knowledge_question")
def handle_line_by_line_answer(session: dict, user_input: str, intent: str,
                                tone: dict, gap_warning: str) -> dict:
    """User asked a content question — answer briefly then continue."""
    if is_document_done(session):
        return _end_line_by_line_result(session, "文档已经讲解完毕。")

    current_segment = get_current_segment(session)
    progress = get_progress_context(session)

    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")
    profile = build_knowledge_profile(oid, nid) if oid and nid else ""

    recent = _recent_history(session, 6)
    messages = build_line_by_line_answer_prompt(
        current_segment=current_segment,
        progress=progress,
        user_question=user_input,
        knowledge_profile=profile,
        gap_warning=gap_warning,
        tone_instruction=tone.get("instruction", ""),
        recent_history=recent,
    )

    raw = call_deepseek(messages)
    result = parse_json_response(raw)

    ai_message = result.get("message", "")
    action = result.get("action", "explain")

    advance_position(session)
    if is_document_done(session):
        action = "end_explanation"

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "reason": result.get("reason", "")},
    })

    return {
        "action": action,
        "ai_message": ai_message,
        "sub_topic": result.get("reason", ""),
        "generated_content": "",
        "knowledge_note": "",
        "completed": action == "end_explanation",
    }


@_register("line_by_line", "meta_question")
@_register("line_by_line", "correction")
@_register("line_by_line", "chitchat")
def handle_line_by_line_brief_reply(session: dict, user_input: str, intent: str,
                                     tone: dict, gap_warning: str) -> dict:
    """User asked about the system, corrected us, or chitchatted.
    Brief response then back to explaining."""
    if is_document_done(session):
        return _end_line_by_line_result(session, "文档已经讲解完毕。")

    current_segment = get_current_segment(session)
    progress = get_progress_context(session)

    hint = ""
    if intent == "meta_question":
        hint = "\n用户问了一个关于你自身的问题。用1句话简要回答，然后立即引用并解释当前句子。"
    elif intent == "correction":
        hint = "\n用户纠正了你。用1句话承认，然后立即引用并解释当前句子。"
    else:
        hint = "\n用1句话简短回应，然后立即引用并解释当前句子。"

    user_lines = [
        f"【{progress}】当前句子：\n\n{current_segment}",
        f"\n用户说：{user_input}",
        hint,
    ]

    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")
    if oid and nid:
        profile = build_knowledge_profile(oid, nid)
        if profile:
            user_lines.insert(0, profile)
    if gap_warning:
        user_lines.insert(0, gap_warning)
    if tone.get("instruction"):
        user_lines.insert(0, tone["instruction"])

    recent = _recent_history(session, 6)
    if recent:
        user_lines.append(f"\n最近对话：\n{recent}")

    messages = [
        {"role": "system", "content": LINE_BY_LINE_ANSWER_SYSTEM},
        {"role": "user", "content": "\n".join(user_lines)},
    ]

    raw = call_deepseek(messages)
    result = parse_json_response(raw)

    ai_message = result.get("message", "")
    action = result.get("action", "explain")

    advance_position(session)
    if is_document_done(session):
        action = "end_explanation"

    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {"action": action, "reason": result.get("reason", "")},
    })

    return {
        "action": action,
        "ai_message": ai_message,
        "sub_topic": result.get("reason", ""),
        "generated_content": "",
        "knowledge_note": "",
        "completed": action == "end_explanation",
    }


@_register("line_by_line", "end_request")
def handle_line_by_line_end(session: dict, user_input: str, intent: str,
                             tone: dict, gap_warning: str) -> dict:
    """User wants to end the line-by-line session."""
    return _end_line_by_line_result(session, "好的，讲解到这里。你可以随时回来继续。")


# ── Fallback Handler ──────────────────────────────────────────────────

def handle_line_by_line_fallback(session: dict, user_input: str, intent: str,
                                  tone: dict, gap_warning: str) -> dict:
    """Fallback: treat as confirmation and explain next segment."""
    return handle_line_by_line_explain(session, user_input, "confirmation", tone, gap_warning)


# ── Public API ────────────────────────────────────────────────────────

def route_and_handle(
    session: dict,
    user_input: str,
    intent: str,
    tone: dict,
    gap_warning: str,
) -> dict:
    """Route to the correct handler based on chat_mode + intent, execute, return result."""
    chat_mode = session.get("chat_mode", "single")
    key = (chat_mode, intent)

    handler = _ROUTE_TABLE.get(key)
    if handler is None and chat_mode == "line_by_line":
        handler = handle_line_by_line_fallback

    if handler:
        return handler(session, user_input, intent, tone, gap_warning)

    # For non-line-by-line modes, return a sentinel that tells process_chat_turn
    # to use the existing legacy handling
    return {"_routed": False, "intent": intent}


# ── Helpers ───────────────────────────────────────────────────────────

def _recent_history(session: dict, n: int = 6) -> str:
    """Get the last N messages as a formatted string."""
    msgs = session.get("messages", [])
    recent = msgs[-n:] if len(msgs) > n else msgs
    lines = []
    for msg in recent:
        role_label = "AI" if msg["role"] == "ai" else "用户"
        content = msg["content"]
        if len(content) > 200:
            content = content[:200] + "..."
        lines.append(f"{role_label}: {content}")
    return "\n".join(lines)


def _end_line_by_line_result(session: dict, message: str) -> dict:
    """Build a standardized 'end explanation' result."""
    session["status"] = "completed"
    session["messages"].append({
        "role": "ai",
        "content": message,
        "timestamp": time.time(),
        "metadata": {"action": "end_explanation"},
    })
    return {
        "action": "end_explanation",
        "ai_message": message,
        "sub_topic": "",
        "generated_content": "",
        "knowledge_note": "",
        "completed": True,
    }
