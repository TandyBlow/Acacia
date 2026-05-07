"""
File-based knowledge point extraction and conversation management service.
Uses DeepSeek API for AI-powered knowledge extraction and dialogue.
"""
import json
import os
import re
import glob
import time
from typing import List, Dict, Any
from uuid import uuid4

import httpx

from file_parser import parse_file

# DeepSeek API configuration
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-fe13ac5f49fa4b9dae15fb4937387203")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"

# Knowledge extraction prompt
KNOWLEDGE_EXTRACTION_PROMPT = """你是一个知识点提取助手。用户会提供学习材料，你需要：
1. 提取出3-15个核心知识点（可独立理解的最小概念单元）
2. 为每个知识点分类：concept（概念）、principle（原理）、application（应用）、comparison（对比）、procedure（步骤方法）
3. 如果知识点超过10个，按主题分组
4. 返回JSON格式：
{
  "total_count": 总知识点数,
  "groups": [
    {
      "group_name": "分组名称",
      "knowledge_points": [
        {
          "id": "kp_1",
          "title": "知识点标题",
          "type": "concept|principle|application|comparison|procedure",
          "brief": "一句话概括",
          "source_content": "原文相关内容（可选，用于后续生成问题）"
        }
      ]
    }
  ]
}

注意：
- 知识点标题要简洁（不超过20字）
- brief要能让人快速理解这个知识点是什么
- 如果知识点≤10个，所有知识点放在一个分组中，group_name为"全部"
- 如果知识点>10个，按主题合理分组（每组3-5个知识点）
- procedure类型用于需要计算步骤示例的方法（如牛顿法、积分技巧、矩阵运算等）
"""

# Question generation prompt template
QUESTION_GENERATION_PROMPT = """你是一个问题生成助手。根据知识点类型生成具体的引导问题：
- concept（概念）：问"用你自己的话说，XX是什么？"
- principle（原理）：问"你觉得XX是怎么工作的？"或"为什么会这样？"
- application（应用）：问"你能想到什么实际例子？"或"XX怎么用？"
- comparison（对比）：问"XX和YY有什么区别？"
- procedure（步骤方法）：问"你觉得XX的核心思路是什么？"或"XX的关键步骤是什么？"

返回JSON格式：
{
  "question": "具体问题",
  "hints": ["提示1", "提示2"]
}

提示用于用户回答"不知道"时给出引导。
"""

# Answer evaluation prompt template
ANSWER_EVALUATION_PROMPT = """你是一个对话引导助手。评估用户的回答质量并决定下一步：
1. 如果回答完整且准确 → 返回 "action": "accept"
2. 如果回答部分正确但不完整 → 返回 "action": "follow_up"，并给出追问
3. 如果回答错误或说"不知道" → 返回 "action": "hint"，并给出提示

返回JSON格式：
{
  "action": "accept|follow_up|hint",
  "reason": "判断理由",
  "next_message": "给用户的回复或追问"
}

注意：
- 追问不要超过2次，第3次自动accept
- 提示要具体，帮助用户理解知识点
- accept时的回复要鼓励用户
"""

# Content generation prompt template
CONTENT_GENERATION_PROMPT = """你是一个笔记生成助手。根据用户的回答生成笔记内容：
1. 核心观点必须来自用户的回答
2. 可以补充必要的细节和示例（来自原始材料）
3. 用Markdown格式
4. 100-200字
5. 语气要像是用户自己写的，不要太正式

返回JSON格式：
{
  "content": "生成的笔记内容（Markdown）"
}
"""

# Example generation prompt template for procedure-type knowledge points
EXAMPLE_GENERATION_PROMPT = """你是一个数学例题生成助手。根据用户对方法的理解，生成一个完整的计算例题。

要求：
1. 例题必须体现用户理解的核心思路
2. 使用 LaTeX 格式（行内公式 $...$，块级公式 $$...$$）
3. 包含：问题描述 + 完整的分步骤解答
4. 每个步骤要有说明文字
5. 100-300字

返回JSON格式：
{
  "example_content": "Markdown格式的例题内容（包含LaTeX）",
  "explanation": "为什么这个例题能说明用户的理解"
}

注意：
- 例题要具体，不要太抽象
- 步骤要清晰，每步都有说明
- LaTeX 语法要正确
"""


def call_deepseek(messages: List[Dict[str, str]]) -> str:
    """Call DeepSeek API."""
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": 0.7,
    }

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(f"{DEEPSEEK_BASE_URL}/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()

    data = resp.json()
    return data["choices"][0]["message"]["content"]


def parse_json_response(raw: str) -> dict:
    """Parse JSON from LLM response, handling code blocks."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON from code block
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        raise ValueError("LLM response is not valid JSON")


def extract_knowledge_points(file_id: str, owner_id: str) -> Dict[str, Any]:
    """
    Extract knowledge points from uploaded file.

    Args:
        file_id: Uploaded file ID
        owner_id: User ID

    Returns:
        Dictionary with total_count and groups of knowledge points
    """
    # Read file content
    file_path = f"/tmp/acacia_uploads/{owner_id}/{file_id}"

    # Find file with any extension
    matching_files = glob.glob(f"{file_path}.*")
    if not matching_files:
        raise FileNotFoundError(f"File not found: {file_id}")

    file_path = matching_files[0]
    text_content = parse_file(file_path)

    if not text_content.strip():
        raise ValueError("文件内容为空")

    # Call DeepSeek to extract knowledge points
    messages = [
        {"role": "system", "content": KNOWLEDGE_EXTRACTION_PROMPT},
        {"role": "user", "content": f"请从以下材料中提取知识点：\n\n{text_content}"}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    # Validate response structure
    if "total_count" not in result or "groups" not in result:
        raise ValueError("Invalid response structure from AI")

    return result


def generate_question_for_knowledge_point(kp: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate a question for a specific knowledge point.

    Args:
        kp: Knowledge point dictionary with id, title, type, brief

    Returns:
        Dictionary with question and hints
    """
    messages = [
        {"role": "system", "content": QUESTION_GENERATION_PROMPT},
        {"role": "user", "content": f"""
知识点信息：
- 标题：{kp['title']}
- 类型：{kp['type']}
- 简介：{kp['brief']}

请生成一个具体的问题。
"""}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    return result


def evaluate_user_answer(
    kp: Dict[str, Any],
    question: str,
    user_answer: str,
    follow_up_count: int = 0
) -> Dict[str, Any]:
    """
    Evaluate user's answer and decide next action.

    Args:
        kp: Knowledge point dictionary
        question: The question asked
        user_answer: User's answer
        follow_up_count: Number of follow-ups so far

    Returns:
        Dictionary with action, reason, next_message
    """
    # Auto-accept after 2 follow-ups
    if follow_up_count >= 2:
        return {
            "action": "accept",
            "reason": "已追问2次，自动接受",
            "next_message": "很好！让我们继续下一个知识点。"
        }

    messages = [
        {"role": "system", "content": ANSWER_EVALUATION_PROMPT},
        {"role": "user", "content": f"""
知识点上下文：
- 标题：{kp['title']}
- 类型：{kp['type']}
- 简介：{kp['brief']}

我的问题：{question}
用户的回答：{user_answer}
已追问次数：{follow_up_count}

请评估这个回答。
"""}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    return result


def generate_content_from_answer(
    kp: Dict[str, Any],
    question: str,
    user_answer: str,
    conversation_history: List[Dict[str, str]]
) -> str:
    """
    Generate note content based on user's answer.

    Args:
        kp: Knowledge point dictionary
        question: The question asked
        user_answer: User's final answer
        conversation_history: Full conversation for this knowledge point

    Returns:
        Generated Markdown content
    """
    # Build conversation context
    conversation_text = "\n".join([
        f"{msg['role']}: {msg['content']}"
        for msg in conversation_history
    ])

    messages = [
        {"role": "system", "content": CONTENT_GENERATION_PROMPT},
        {"role": "user", "content": f"""
知识点：{kp['title']}
类型：{kp['type']}

对话历史：
{conversation_text}

最终问题：{question}
用户的回答：{user_answer}

原始材料片段：
{kp.get('source_content', kp['brief'])}

请生成笔记内容。
"""}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    return result.get("content", "")


def generate_example_for_procedure(
    kp: Dict[str, Any],
    user_answer: str,
    conversation_history: List[Dict[str, str]],
    previous_example: str | None = None,
    user_feedback: str | None = None
) -> Dict[str, Any]:
    """
    Generate a calculation example for procedure-type knowledge point.

    Args:
        kp: Knowledge point dictionary
        user_answer: User's final answer explaining their understanding
        conversation_history: Full conversation for this knowledge point
        previous_example: Previous generated example (for regeneration)
        user_feedback: User's feedback on previous example (for regeneration)

    Returns:
        Dictionary with example_content and explanation
    """
    # Build conversation context
    conversation_text = "\n".join([
        f"{msg['role']}: {msg['content']}"
        for msg in conversation_history
    ])

    # Build prompt
    prompt_parts = [
        f"知识点：{kp['title']}",
        f"类型：{kp['type']}",
        f"简介：{kp['brief']}",
        "",
        "对话历史：",
        conversation_text,
        "",
        f"用户的理解：{user_answer}",
    ]

    if kp.get('source_content'):
        prompt_parts.extend([
            "",
            "原始材料片段：",
            kp['source_content']
        ])

    # Add regeneration context if provided
    if previous_example and user_feedback:
        prompt_parts.extend([
            "",
            "之前生成的例题：",
            previous_example,
            "",
            "用户的反馈：",
            user_feedback,
            "",
            "请根据反馈重新生成一个不同的例题。"
        ])

    user_content = "\n".join(prompt_parts)

    messages = [
        {"role": "system", "content": EXAMPLE_GENERATION_PROMPT},
        {"role": "user", "content": user_content}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    # Validate response structure
    if "example_content" not in result:
        raise ValueError("Invalid example generation response: missing example_content")

    return result


# In-memory conversation session storage
# In production, consider using Redis or SQLite for persistence
_conversation_sessions: Dict[str, Dict[str, Any]] = {}


def create_conversation_session(
    node_id: str,
    owner_id: str,
    file_id: str,
    knowledge_points: List[Dict[str, Any]]
) -> str:
    """
    Create a new conversation session.

    Args:
        node_id: Target node ID
        owner_id: User ID
        file_id: Uploaded file ID
        knowledge_points: List of selected knowledge points

    Returns:
        Session ID
    """
    session_id = str(uuid4())

    _conversation_sessions[session_id] = {
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
        "pending_example": None,  # NEW: Store pending example for confirmation
        "example_history": [],    # NEW: Track previous examples
    }

    return session_id


def get_conversation_session(session_id: str) -> Dict[str, Any]:
    """Get conversation session by ID."""
    session = _conversation_sessions.get(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    # Update last activity
    session["last_activity_at"] = time.time()
    return session


def start_conversation(
    node_id: str,
    owner_id: str,
    file_id: str,
    knowledge_points: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Start a new conversation session and generate first question.

    Args:
        node_id: Target node ID
        owner_id: User ID
        file_id: Uploaded file ID
        knowledge_points: List of selected knowledge points

    Returns:
        Dictionary with session_id, question, and current knowledge point info
    """
    if not knowledge_points:
        raise ValueError("No knowledge points provided")

    session_id = create_conversation_session(node_id, owner_id, file_id, knowledge_points)
    session = _conversation_sessions[session_id]

    # Generate first question
    current_kp = knowledge_points[0]
    question_data = generate_question_for_knowledge_point(current_kp)

    # Add to message history
    session["messages"].append({
        "role": "ai",
        "content": question_data["question"],
        "timestamp": time.time(),
        "metadata": {
            "kp_id": current_kp["id"],
            "hints": question_data.get("hints", [])
        }
    })

    return {
        "session_id": session_id,
        "question": question_data["question"],
        "hints": question_data.get("hints", []),
        "current_kp": {
            "index": 0,
            "total": len(knowledge_points),
            "title": current_kp["title"],
            "type": current_kp["type"],
        }
    }


def process_conversation_turn(
    session_id: str,
    user_answer: str,
    skip: bool = False
) -> Dict[str, Any]:
    """
    Process one conversation turn: user answer -> AI evaluation -> next action.

    Args:
        session_id: Conversation session ID
        user_answer: User's answer to current question
        skip: If True, skip current knowledge point

    Returns:
        Dictionary with action, ai_message, generated_content (if any), and progress info
    """
    session = get_conversation_session(session_id)

    current_index = session["current_index"]
    knowledge_points = session["knowledge_points"]
    current_kp = knowledge_points[current_index]

    # Add user message to history
    session["messages"].append({
        "role": "user",
        "content": user_answer,
        "timestamp": time.time(),
    })

    # Handle skip
    if skip:
        session["current_index"] += 1
        session["follow_up_count"] = 0

        # Check if all knowledge points completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            return {
                "action": "completed",
                "ai_message": "所有知识点已完成！",
                "generated_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)

        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        return {
            "action": "next_question",
            "ai_message": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    # Evaluate user's answer
    last_question = None
    for msg in reversed(session["messages"]):
        if msg["role"] == "ai" and msg.get("metadata", {}).get("kp_id") == current_kp["id"]:
            last_question = msg["content"]
            break

    evaluation = evaluate_user_answer(
        current_kp,
        last_question or "",
        user_answer,
        session["follow_up_count"]
    )

    action = evaluation["action"]
    ai_message = evaluation["next_message"]

    # Add AI response to history
    session["messages"].append({
        "role": "ai",
        "content": ai_message,
        "timestamp": time.time(),
        "metadata": {
            "action": action,
            "reason": evaluation.get("reason", "")
        }
    })

    # Handle different actions
    if action == "accept":
        # Get conversation messages for this knowledge point
        kp_messages = [
            msg for msg in session["messages"]
            if msg.get("metadata", {}).get("kp_id") == current_kp["id"] or
               (msg["role"] == "user" and session["messages"].index(msg) >
                next((i for i, m in enumerate(session["messages"])
                      if m.get("metadata", {}).get("kp_id") == current_kp["id"]), 0))
        ]

        # Check if this is a procedure-type knowledge point
        if current_kp.get("type") == "procedure":
            # Generate example instead of final content
            example_result = generate_example_for_procedure(
                current_kp,
                user_answer,
                kp_messages
            )

            # Store pending example in session
            session["pending_example"] = {
                "example_content": example_result["example_content"],
                "explanation": example_result.get("explanation", ""),
                "user_answer": user_answer,
                "kp_messages": kp_messages
            }

            # Return example for user confirmation
            return {
                "action": "example_preview",
                "ai_message": ai_message,
                "example_content": example_result["example_content"],
                "explanation": example_result.get("explanation", ""),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": current_kp["title"],
                    "kp_type": current_kp["type"],
                }
            }

        # For non-procedure types, generate content directly
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

        # Move to next knowledge point
        session["current_index"] += 1
        session["follow_up_count"] = 0

        # Check if all completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            return {
                "action": "completed",
                "ai_message": ai_message,
                "generated_content": generated_content,
                "total_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)

        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        return {
            "action": "accept_and_next",
            "ai_message": ai_message,
            "generated_content": generated_content,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    elif action == "follow_up":
        session["follow_up_count"] += 1
        return {
            "action": "follow_up",
            "ai_message": ai_message,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "hint":
        return {
            "action": "hint",
            "ai_message": ai_message,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    return {
        "action": "unknown",
        "ai_message": ai_message,
        "progress": {
            "current": session["current_index"],
            "total": len(knowledge_points),
        }
    }


def cleanup_old_sessions(max_age_seconds: int = 1800):
    """Clean up sessions older than max_age_seconds (default 30 minutes)."""
    current_time = time.time()
    to_delete = []

    for session_id, session in _conversation_sessions.items():
        if current_time - session["last_activity_at"] > max_age_seconds:
            to_delete.append(session_id)

    for session_id in to_delete:
        del _conversation_sessions[session_id]

    return len(to_delete)


def process_example_feedback(
    session_id: str,
    action: str,
    feedback: str = ""
) -> Dict[str, Any]:
    """
    Process user feedback on generated example for procedure-type knowledge point.

    Args:
        session_id: Conversation session ID
        action: User action - "accept", "regenerate", or "skip"
        feedback: User feedback for regeneration (required if action is "regenerate")

    Returns:
        Dictionary with action result, next question (if any), and progress info
    """
    session = get_conversation_session(session_id)

    # Validate pending example exists
    if not session.get("pending_example"):
        raise ValueError("No pending example to process")

    pending_example = session["pending_example"]
    current_index = session["current_index"]
    knowledge_points = session["knowledge_points"]
    current_kp = knowledge_points[current_index]

    if action == "accept":
        # Combine user answer with example to create final content
        user_answer = pending_example["user_answer"]
        example_content = pending_example["example_content"]

        # Generate final content combining understanding and example
        final_content = f"{user_answer}\n\n{example_content}"

        # Append to accumulated content
        if session["generated_content"]:
            session["generated_content"] += "\n\n---\n\n"
        session["generated_content"] += f"## {current_kp['title']}\n\n{final_content}"

        # Clear pending example
        session["pending_example"] = None

        # Move to next knowledge point
        session["current_index"] += 1
        session["follow_up_count"] = 0

        # Check if all completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            return {
                "action": "completed",
                "ai_message": "所有知识点已完成！",
                "generated_content": final_content,
                "total_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)

        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        return {
            "action": "accept_and_next",
            "ai_message": "很好！让我们继续下一个知识点。",
            "generated_content": final_content,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    elif action == "regenerate":
        # Check regeneration limit (max 3 attempts)
        example_history = session.get("example_history", [])
        regeneration_count = len([e for e in example_history if e.get("kp_id") == current_kp["id"]])

        if regeneration_count >= 3:
            return {
                "action": "regeneration_limit_reached",
                "ai_message": "已达到重新生成次数上限（3次）。您可以选择接受当前例题或跳过。",
                "example_content": pending_example["example_content"],
                "explanation": pending_example.get("explanation", ""),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": current_kp["title"],
                    "kp_type": current_kp["type"],
                }
            }

        if not feedback:
            raise ValueError("Feedback is required for regeneration")

        # Store current example in history
        if "example_history" not in session:
            session["example_history"] = []
        session["example_history"].append({
            "kp_id": current_kp["id"],
            "example_content": pending_example["example_content"],
            "timestamp": time.time()
        })

        # Generate new example with feedback
        kp_messages = pending_example["kp_messages"]
        user_answer = pending_example["user_answer"]

        new_example_result = generate_example_for_procedure(
            current_kp,
            user_answer,
            kp_messages,
            previous_example=pending_example["example_content"],
            user_feedback=feedback
        )

        # Update pending example
        session["pending_example"] = {
            "example_content": new_example_result["example_content"],
            "explanation": new_example_result.get("explanation", ""),
            "user_answer": user_answer,
            "kp_messages": kp_messages
        }

        return {
            "action": "example_regenerated",
            "ai_message": "我根据您的反馈重新生成了例题，请查看。",
            "example_content": new_example_result["example_content"],
            "explanation": new_example_result.get("explanation", ""),
            "regeneration_count": regeneration_count + 1,
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": current_kp["title"],
                "kp_type": current_kp["type"],
            }
        }

    elif action == "skip":
        # Generate text-only content without example
        user_answer = pending_example["user_answer"]
        kp_messages = pending_example["kp_messages"]

        # Get last question
        last_question = None
        for msg in reversed(session["messages"]):
            if msg["role"] == "ai" and msg.get("metadata", {}).get("kp_id") == current_kp["id"]:
                last_question = msg["content"]
                break

        # Generate content from answer only
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

        # Clear pending example
        session["pending_example"] = None

        # Move to next knowledge point
        session["current_index"] += 1
        session["follow_up_count"] = 0

        # Check if all completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            return {
                "action": "completed",
                "ai_message": "所有知识点已完成！",
                "generated_content": generated_content,
                "total_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }

        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)

        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })

        return {
            "action": "skip_and_next",
            "ai_message": "好的，我们跳过例题，继续下一个知识点。",
            "generated_content": generated_content,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }

    else:
        raise ValueError(f"Invalid action: {action}. Must be 'accept', 'regenerate', or 'skip'")

