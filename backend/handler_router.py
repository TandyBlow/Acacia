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
    get_context_window,
    get_position_marker,
)
from chat_service import (
    call_deepseek,
    parse_json_response,
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

    # Confirmation means "I understood the previous segment, move forward"
    # Advance FIRST, then explain the new current segment
    advance_position(session)
    if is_document_done(session):
        return _end_line_by_line_result(session, "文档已经讲解完毕。")

    current_segment = get_current_segment(session)
    progress = get_progress_context(session)
    ctx_window = get_context_window(session)
    pos_marker = get_position_marker(session)

    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")

    # Read enriched context from pre-processing pipeline
    # (concept extraction + knowledge retrieval by content — already filtered by relevance)
    enriched = session.get("_enriched_context", {}) or {}
    concept_ctx = enriched.get("concept_context", "")
    personalized = enriched.get("personalized_context", "")
    expansion = enriched.get("expansion_context", "")
    import sys
    print(f"[HANDLER explain] concept_ctx={len(concept_ctx)}chars, personalized={len(personalized)}chars, expansion={len(expansion)}chars", file=sys.stderr)

    recent = _recent_history(session, 6)
    messages = build_line_by_line_explain_prompt(
        current_segment=current_segment,
        progress=progress,
        knowledge_profile="",  # enriched context replaces full profile
        gap_warning=gap_warning,
        tone_instruction=tone.get("instruction", ""),
        recent_history=recent,
        context_window=ctx_window,
        position_marker=pos_marker,
        concept_context=concept_ctx,
        personalized_context=personalized,
        expansion_context=expansion,
    )

    raw = call_deepseek(messages)
    result = parse_json_response(raw)

    ai_message = result.get("message", "")
    action = result.get("action", "explain")

    # Position already advanced at start — just check if done
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
        "mentioned_concepts": _extract_mentioned_concepts(session),
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
    ctx_window = get_context_window(session)
    pos_marker = get_position_marker(session)

    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")

    # Read enriched context from pre-processing pipeline
    enriched = session.get("_enriched_context", {}) or {}
    concept_ctx = enriched.get("concept_context", "")
    personalized = enriched.get("personalized_context", "")
    expansion = enriched.get("expansion_context", "")
    def_chain = enriched.get("definition_chain", "")

    recent = _recent_history(session, 6)
    messages = build_line_by_line_answer_prompt(
        current_segment=current_segment,
        progress=progress,
        user_question=user_input,
        knowledge_profile="",  # enriched context replaces full profile
        gap_warning=gap_warning,
        tone_instruction=tone.get("instruction", ""),
        recent_history=recent,
        context_window=ctx_window,
        position_marker=pos_marker,
        concept_context=concept_ctx,
        personalized_context=personalized,
        expansion_context=expansion,
        definition_chain=def_chain,
    )

    raw = call_deepseek(messages)
    result = parse_json_response(raw)

    ai_message = result.get("message", "")
    action = result.get("action", "explain")

    # Do NOT advance — user asked a question, stay on current segment
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
        "mentioned_concepts": _extract_mentioned_concepts(session),
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
    ctx_window = get_context_window(session)
    pos_marker = get_position_marker(session)

    hint = ""
    if intent == "meta_question":
        hint = "\n用户问了一个关于你自身的问题。简要回答后，继续讲解当前段落。"
    elif intent == "correction":
        hint = "\n用户纠正了你。承认错误，然后继续讲解当前段落。"
    else:
        hint = "\n简短回应后，继续讲解当前段落。"

    user_lines = []
    if ctx_window:
        user_lines.append(f"【文档上下文】（当前位置附近的段落）\n{ctx_window}")
    if pos_marker:
        user_lines.append(f"【{pos_marker}】")
    if gap_warning:
        user_lines.append(gap_warning)
    if tone.get("instruction"):
        user_lines.append(tone["instruction"])
    user_lines.append(f"【{progress}】当前句子：\n\n{current_segment}")
    user_lines.append(f"\n用户说：{user_input}")
    user_lines.append(hint)

    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")

    # Read enriched context from pre-processing pipeline
    # (concept extraction + knowledge retrieval by content — already filtered by relevance)
    enriched = session.get("_enriched_context", {}) or {}
    concept_ctx = enriched.get("concept_context", "")
    personalized = enriched.get("personalized_context", "")
    expansion = enriched.get("expansion_context", "")
    if concept_ctx:
        user_lines.append(concept_ctx)
    if personalized:
        user_lines.append(personalized)
    if expansion:
        user_lines.append(expansion)

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

    # Brief replies should not advance position — user didn't confirm
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
        "mentioned_concepts": _extract_mentioned_concepts(session),
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
        "mentioned_concepts": _extract_mentioned_concepts(session),
    }


def _extract_mentioned_concepts(session: dict) -> list:
    """Extract mentioned concepts from the session's enriched context, excluding
    concepts that already exist as children of the current node.

    Lazily triggers post-response concept extraction from the AI's latest reply,
    so the chips reflect what was actually taught rather than broad conversation topics.
    """
    # Trigger post-response extraction if not yet done this turn
    if not session.get("_response_concepts") and not session.get("_response_extraction_attempted"):
        session["_response_extraction_attempted"] = True
        try:
            from chat_service import _refresh_response_concepts
            _refresh_response_concepts(session)
        except Exception:
            pass

    enriched = session.get("_enriched_context", {}) or {}
    # Prefer post-response concepts (extracted from AI's actual reply) over
    # pre-processing concepts (extracted from conversation history before AI responded)
    raw_concepts = session.get("_response_concepts") or enriched.get("concepts", [])
    if not raw_concepts:
        return []

    # Fetch existing child names so we can skip concepts the user already has
    existing_names: set = set()
    oid = session.get("owner_id", "")
    nid = session.get("node_id", "")
    if oid and nid:
        try:
            from tree_repository_sqlite import get_db_ctx as _get_db_ctx
            with _get_db_ctx() as _conn:
                rows = _conn.execute(
                    "SELECT name FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0",
                    (oid, nid)
                ).fetchall()
                existing_names = {r["name"] for r in rows}
        except Exception:
            pass

    result = []
    for c in raw_concepts:
        name = c.get("name", "")
        if name in existing_names:
            continue
        result.append({
            "name": name,
            "category": c.get("category", ""),
            "definition": c.get("definition", ""),
            "prerequisites": c.get("prerequisites", []),
            "expansion_directions": c.get("expansion_directions", []),
            "verified": c.get("verified", False),
            "wiki_summary": c.get("wiki_summary", ""),
            "wiki_description": c.get("wiki_description", ""),
        })
    return result
